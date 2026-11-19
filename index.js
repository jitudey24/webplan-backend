
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";

import {
  connectDB,
  getDB,
  closeDB,
  getClient,
} from "./src/config/db.js";

import { ensureIndexes } from "./src/config/indexes.js";
import { initAuth } from "./src/lib/auth.js";

import profileRoutes from "./src/routes/profile.js";
import servicesRoutes from "./src/routes/services.js";
import bookingRoutes from "./src/routes/bookings.js";
import adminRoutes from "./src/routes/admin.js";
import plannerRoutes from "./src/routes/planner.js";
import subscriptionRoutes from "./src/routes/subscription.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);

const startServer = async () => {
  try {
    const db = await connectDB();

    console.log("MongoDB Connected Successfully!");

    const auth = await initAuth(db, getClient());

    app.all("/api/auth/*splat", toNodeHandler(auth));

    app.use(express.json());

    await ensureIndexes(db);

    app.get("/", (req, res) => {
      res.send("Welcome to WedPlan Server!");
    });

    app.get("/health", (req, res) => {
      res.status(200).json({
        success: true,
        message: "WedPlan Server is Running!",
      });
    });

    app.get("/test-db", async (req, res) => {
      try {
        const database = getDB();
        await database.command({ ping: 1 });

        res.status(200).json({
          success: true,
          message: "MongoDB Connected Successfully!",
          database: database.databaseName,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    app.use("/api/v1/profile", profileRoutes);
    app.use("/api/v1/services", servicesRoutes);
    app.use("/services", servicesRoutes);
    app.use("/api/v1/bookings", bookingRoutes);
    app.use("/api/v1/admin", adminRoutes);
    app.use("/api/v1/planner", plannerRoutes);
    app.use("/api/v1/subscription", subscriptionRoutes);

    app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.originalUrl}`,
      });
    });

    app.use((error, req, res, next) => {
      console.error("API Error:", error.message);

      const status =
        typeof error?.status === "number"
          ? error.status
          : typeof error?.statusCode === "number"
            ? error.statusCode
            : 500;

      res.status(status).json({
        success: false,
        message: error.message || "Internal server error.",
      });
    });

    app.listen(PORT, () => {
      console.log(`WedPlan Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server Startup Failed:", error);
    process.exit(1);
  }
};

process.on("SIGINT", async () => {
  await closeDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDB();
  process.exit(0);
});

startServer();
