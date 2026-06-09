import { ActionType } from "./ActionType";

export interface PlayerAction {

  id: string;

  type: ActionType;

  title: string;

  description: string;
}