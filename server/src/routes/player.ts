import express from "express";

import { game } from "../game/GameStore";

const router = express.Router();

router.post(
  "/action",
  (req, res) => {

    const action = req.body;

    game.playerActions.push(
      action
    );

    res.json({
      success: true
    });
  }
);

export default router;