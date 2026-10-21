import React from "react";
import { createRoot } from "react-dom/client";
import SaunaPlanner from "./SaunaPlanner.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SaunaPlanner />
  </React.StrictMode>,
);
