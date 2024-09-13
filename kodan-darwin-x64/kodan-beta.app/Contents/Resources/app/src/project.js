import React from "react";
import { createRoot } from "react-dom/client";
import ProjectComponent from "./components/ProjectComponent";

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<ProjectComponent />);
