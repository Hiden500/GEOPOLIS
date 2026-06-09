import { useEffect, useState } from "react";
import {
  getGameState,
  nextTurn
} from "./api/gameApi";
import { type Event } from "@shared/types/Event";
import { type GameState } from "@shared/types/GameState";
import { type PlayerAction } from "@shared/types/actions/PlayerAction";
import { PlayerCountryPanel } from "./components/PlayerCountryPanel";
/*
function App() {

  const [game, setGame] = useState<GameState | null>(null);

  const [actionText, setActionText] =
    useState("");

  useEffect(() => {
    loadGame();
  }, []);

  async function loadGame() {

    const state =
      await getGameState();

    setGame(state);
  }

  async function handleNextTurn() {

    const state =
      await nextTurn();

    setGame(state);
  }

  async function saveAction() {

    if (!actionText.trim()) {
      return;
    }

    await fetch(
      "http://localhost:3000/player/action",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          id: crypto.randomUUID(),

          category: "politics",

          description:
            actionText
        })
      }
    );

    setActionText("");

    await loadGame();
  }
  if (!game) {
    return <div>Loading...</div>;
  }

  const playerCountry =
    game.countries.find(
      c => c.id === "USSR"
    );

  if (!playerCountry) {
    return (
      <div>
        Ошибка: страна игрока не найдена
      </div>
    );
  }

  return (

    <div
      style={{
        padding: 20,
        maxWidth: 1200,
        margin: "0 auto",
        fontFamily:
          "Arial, sans-serif"
      }}
    >

      <h1>
        AI Grand Strategy
      </h1>

      <hr />

      <h2>
        Текущая дата:
        {" "}
        {game.currentDate}
      </h2>

      <div
        style={{
          marginTop: 20,
          marginBottom: 20
        }}
      >

        <button
          onClick={handleNextTurn}
        >
          Следующий месяц
        </button>

      </div>

      <hr />

      <h2>
        Новая директива
      </h2>

      <textarea
        value={actionText}
        onChange={(e) =>
          setActionText(
            e.target.value
          )
        }
        rows={5}
        style={{
          width: "100%"
        }}
        placeholder="
Например:

Ускорить атомный проект

Поддержать китайских коммунистов

Построить новый металлургический комбинат
"
      />

      <div
        style={{
          marginTop: 10
        }}
      >

        <button
          onClick={saveAction}
        >
          Добавить директиву
        </button>

      </div>

      <hr />

      <h2>
        Активные директивы
      </h2>

      {game.playerActions?.length === 0 && (
        <p>
          Нет активных директив
        </p>
      )}

      {game.playerActions?.map(
        (action: PlayerAction) => (

          <div
            key={action.id}
            style={{
              padding: 10,
              border:
                "1px solid #ccc",
              marginBottom: 10
            }}
          >

            <strong>
              {action.type}
            </strong>

            <p>
              {action.description}
            </p>

          </div>
        )
      )}

      <hr />

      <h2>
        Ваша страна
      </h2>
      <PlayerCountryPanel
        country={playerCountry}
      />

      <h2>Армия</h2>

      {playerCountry.military.units.map(
        unit => (

          <div key={unit.id}>

            <strong>
              {unit.name}
            </strong>

            <div>
              Тип: {unit.type}
            </div>

            <div>
              Сила: {unit.strength}
            </div>

            <div>
              Опыт: {unit.experience}
            </div>

          </div>
        )
      )}

      <h2>Регионы</h2>

      {game.regions.map(region => (

        <div key={region.id}>

          <strong>
            {region.name}
          </strong>

          <div>
            Население:
            {region.population}
          </div>

        </div>

      ))}

      <h3>
        Ресурсы
      </h3>

      <ul>

        <li>
          Нефть:
          {playerCountry.stockpile.oil}
        </li>

        <li>
          Уголь:
          {playerCountry.stockpile.coal}
        </li>

        <li>
          Уран:
          {playerCountry.stockpile.uranium}
        </li>

      </ul>

      <hr />

      <h2>
        Журнал событий
      </h2>

      {game.eventHistory?.length === 0 && (
        <p>
          Пока нет событий
        </p>
      )}

      {[...game.eventHistory]
        .reverse()
        .map((event: Event) => (

          <div
            key={event.id}
            style={{
              border:
                "1px solid #ddd",
              padding: 12,
              marginBottom: 12
            }}
          >

            <h4>
              {event.title}
            </h4>

            <p>
              {event.description}
            </p>

            <small>
              {event.date}
            </small>

          </div>
        ))
      }

    </div>
  );
}

export default App;*/

import { MapView } from "./map/MapView";

function App() {
  return <MapView />;
}

export default App;