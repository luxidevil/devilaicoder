import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installAuthFetch } from "./lib/api-fetch";

installAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);
