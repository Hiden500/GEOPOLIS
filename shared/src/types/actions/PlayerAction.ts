import { ActionType } from "./ActionType";

export interface PlayerAction {

  id: string;

  type: ActionType;

  regionId: number;

  title: string;

  description: string;

  parameters?: Record<string, any>;

  createdAt?: string;
}