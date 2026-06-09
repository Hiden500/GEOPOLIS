import express from "express";
import cors from "cors";

import gameRoutes from "./routes/game";
import playerRoutes from "./routes/player";

const app = express();

app.use(cors());

app.use(express.json());

app.use("/game", gameRoutes);
app.use("/player", playerRoutes);

app.listen(3000, () => {
  console.log("Server started");
});