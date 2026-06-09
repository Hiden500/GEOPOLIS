import express from "express";

import { game } from "../game/GameStore";
import { runTurn } from "../game/RunTurn";
import { TimeStep } from "../time/TimeStep";

const router = express.Router();

router.get("/state", (req, res) => {
  res.json(game);
});

router.post("/next-turn", (req, res) => {

  runTurn(
    game,
    TimeStep.OneMonth
  );

  res.json(game);
});

export default router;