/**
 * Генерация игрового ассета изображением — портреты, флаги вымышленных стран,
 * текстуры, иллюстрации.
 *
 * ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Это инструмент разработки, а не рантайм игры: ассеты
 * делаются заранее и кладутся в репозиторий. Ход партии изображений не
 * генерирует — 7–11 секунд и сотни килобайт на ход не оправданы ничем, а сейв
 * с картинками не уложится в бюджет `CONCEPT.md` §7 (SAVE < ~3–5 МБ).
 *
 * ПОЧЕМУ РЯДОМ ПИШЕТСЯ `.json`. Сгенерированный ассет невоспроизводим без
 * промта и имени модели, а «откуда это взялось» — тот же вопрос провенанса, что
 * у внешних данных (`AGENTS.md`). Sidecar отвечает на него, лежит рядом с
 * файлом и переживает пересборку набора.
 *
 * Запуск (из `server/`, при заполненном `server/.env`):
 *   npx tsx scripts/generateAsset.ts --kind portrait --id leaders/sun-1946 \
 *     --subject "a stern Soviet head of state in a plain military tunic"
 */
import "./loadEnv";
import * as fs from "node:fs";
import * as path from "node:path";
import { localBaseUrl, localHeaders } from "../src/llm/providers/localEndpoint";
import { ASSET_KINDS, ASSET_TEMPLATES, buildAssetPrompt, type AssetKind } from "./assetPrompts";

/**
 * Модель фиксирована здесь, а не взята из `LOCAL_LLM_MODEL`: та переменная
 * задаёт ТЕКСТОВУЮ модель хода, и прогон партии, случайно унёсший генерацию
 * ассетов на неё, получил бы прозу вместо картинки. Переопределяется явно —
 * `LOCAL_IMAGE_MODEL`.
 */
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";

/** Замер 2026-08-02: 7–11 с на изображение. Минута — запас, не ожидание. */
const TIMEOUT_MS = 60_000;

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Размеры JPEG из заголовка — без зависимостей.
 *
 * Библиотеки обработки растра в проекте нет (проверено: ни `sharp`, ни `jimp`,
 * ни `canvas`), а тащить её ради двух чисел — плохой обмен. Нужны эти числа
 * затем, что подсказка о форме кадра моделью НЕ гарантируется: у флага СССР она
 * выдала 3:2 там, где просили другое. Молча принять кадр не той формы — значит
 * положить в набор ассет, который поедет в вёрстке.
 */
function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    // SOF0..SOF15, кроме DHT (c4), JPGA (c8) и DAC (cc) — у них другая роль.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + buf.readUInt16BE(offset + 2);
  }
  return undefined;
}

async function generate(prompt: string, model: string): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(`${localBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: localHeaders(),
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 4096 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  // Картинка приходит НЕ в `content`, а в нестандартном поле `images` — это
  // особенность шлюза, а не спецификация OpenAI (`/v1/images/generations` там
  // отвечает 502 на все предлагаемые им же модели). Смена шлюза сломает это
  // место первым, поэтому ошибка называет поле явно.
  const url: string = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  const parsed = /^data:(image\/\w+);base64,(.+)$/s.exec(url);
  if (!parsed) {
    throw new Error(
      `ответ без изображения в message.images[0].image_url.url; получено: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  return { buf: Buffer.from(parsed[2]!, "base64"), mime: parsed[1]! };
}

async function main(): Promise<void> {
  const kind = arg("kind") as AssetKind | undefined;
  const id = arg("id");
  const subject = arg("subject");
  const outRoot = path.resolve(arg("out") ?? path.join("..", "assets", "generated"));
  const model = process.env.LOCAL_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;

  if (!kind || !ASSET_KINDS.includes(kind) || !id || !subject) {
    console.error(
      `Запуск: npx tsx scripts/generateAsset.ts --kind <${ASSET_KINDS.join("|")}> --id <путь/имя> --subject "<что изображено>" [--out <каталог>]`
    );
    process.exit(1);
  }

  const prompt = buildAssetPrompt(kind, subject);
  console.log(`модель: ${model}\nвид:    ${kind}\nпромт:  ${prompt}\n`);

  const started = Date.now();
  const { buf, mime } = await generate(prompt, model);
  const seconds = (Date.now() - started) / 1000;

  const size = jpegSize(buf);
  const ratio = size ? size.width / size.height : undefined;
  const expected = ASSET_TEMPLATES[kind].expectedRatio;
  // 5% допуска: модель попадает в форму кадра приблизительно, и требовать
  // точного совпадения значило бы браковать пригодные ассеты.
  const aspectOk = ratio !== undefined && Math.abs(ratio - expected) / expected <= 0.05;

  const file = path.join(outRoot, kind, `${id}.${mime.split("/")[1]}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);

  const sidecar = file.replace(/\.\w+$/, ".json");
  fs.writeFileSync(
    sidecar,
    JSON.stringify(
      {
        id,
        kind,
        subject,
        prompt,
        model,
        generatedAt: new Date().toISOString(),
        bytes: buf.length,
        mime,
        width: size?.width ?? null,
        height: size?.height ?? null,
        aspectExpected: Number(expected.toFixed(4)),
        aspectActual: ratio ? Number(ratio.toFixed(4)) : null,
        aspectWithinTolerance: aspectOk,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`сохранено: ${file}`);
  console.log(`провенанс: ${sidecar}`);
  console.log(
    `${seconds.toFixed(1)} с, ${(buf.length / 1024).toFixed(0)} КБ, ` +
      `${size ? `${size.width}×${size.height}` : "размер не прочитан"}` +
      (size ? `, соотношение ${ratio!.toFixed(2)} при ожидаемом ${expected.toFixed(2)}` : "")
  );
  if (!aspectOk) {
    // Не падение: ассет сгенерирован и может подойти. Но молчать нельзя —
    // именно так в набор попадает картинка, которую потом растянет вёрстка.
    console.warn("ВНИМАНИЕ: форма кадра вне допуска — проверь ассет перед тем, как класть в набор.");
  }
}

main().catch(error => {
  console.error("ошибка:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
