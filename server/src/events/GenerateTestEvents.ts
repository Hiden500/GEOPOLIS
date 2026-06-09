import { type Event } from "@shared/types/Event";
import { type PlayerAction } from "@shared/types/actions/PlayerAction";

export function generateTestEvents(
  actions: PlayerAction[],
  date: string
): Event[] {

  return actions.map(
    action => ({

      id: crypto.randomUUID(),

      date,

      title:
        "Выполнение директивы",

      description:
        action.description,

      countries: []
    })
  );
}