import express from "express";
import cors from "cors";
import gameRoutes from "./routes/game";
import playerRoutes from "./routes/player";
import scenarioRoutes from "./routes/scenarios";
import actionsRoutes from "./routes/actions";
import budgetRoutes from "./routes/budget";
import researchRoutes from "./routes/research";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/game", gameRoutes);
app.use("/player", playerRoutes);
app.use("/scenarios", scenarioRoutes);
app.use("/actions", actionsRoutes);
app.use("/budget", budgetRoutes);
app.use("/research", researchRoutes);

app.listen(3000, () => {
  console.log("Server started");
});