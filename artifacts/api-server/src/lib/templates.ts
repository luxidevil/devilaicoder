export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  language: string;
  icon: string;
  files: { path: string; content: string }[];
}

const VITE_REACT_PKG = `{
  "name": "vite-react-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc && vite build",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", port: 5173 },
});
`;

const VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const VITE_MAIN = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const VITE_APP = `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div style={{ fontFamily: "system-ui", padding: 40, textAlign: "center" }}>
      <h1>Vite + React</h1>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
      <p>Edit <code>src/App.tsx</code> and save to hot-reload.</p>
    </div>
  );
}
`;

const VITE_CSS = `:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
button { font-size: 1rem; padding: 0.5rem 1rem; cursor: pointer; }
`;

const VITE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
`;

const EXPRESS_PKG = `{
  "name": "express-ts-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
`;

const EXPRESS_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

const EXPRESS_INDEX = `import express from "express";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, "0.0.0.0", () => {
  console.log(\`Server running on http://0.0.0.0:\${PORT}\`);
});
`;

const FLASK_REQ = `flask>=3.0.0
`;

const FLASK_APP = `from flask import Flask, jsonify
import os

app = Flask(__name__)

@app.get("/")
def home():
    return jsonify(message="Hello from Flask!")

@app.get("/api/health")
def health():
    return jsonify(status="ok")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
`;

const STATIC_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Site</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <h1>Hello, World!</h1>
      <p>Edit <code>index.html</code> and refresh to see changes.</p>
      <button id="btn">Click me</button>
    </main>
    <script src="script.js"></script>
  </body>
</html>
`;

const STATIC_CSS = `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; display: grid; place-items: center; background: #0a0a0a; color: #fff; }
main { text-align: center; padding: 2rem; }
button { padding: 0.5rem 1.5rem; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; cursor: pointer; font-size: 1rem; }
button:hover { background: #2a2a2a; }
`;

const STATIC_JS = `let clicks = 0;
document.getElementById("btn").addEventListener("click", () => {
  clicks++;
  document.querySelector("h1").textContent = \`Clicked \${clicks} time\${clicks === 1 ? "" : "s"}\`;
});
`;

const NEXT_PKG = `{
  "name": "next-app",
  "private": true,
  "scripts": {
    "dev": "next dev -H 0.0.0.0",
    "build": "next build",
    "start": "next start -H 0.0.0.0"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.6.0"
  }
}
`;

const NEXT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`;

const NEXT_LAYOUT = `export const metadata = { title: "Next.js App", description: "Built on Luxi" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", margin: 0 }}>{children}</body></html>
  );
}
`;

const NEXT_PAGE = `export default function Home() {
  return (
    <main style={{ padding: 40, textAlign: "center" }}>
      <h1>Welcome to Next.js</h1>
      <p>Edit <code>app/page.tsx</code> and save to hot-reload.</p>
    </main>
  );
}
`;

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty project. Start from scratch with the agent.",
    language: "javascript",
    icon: "FileText",
    files: [],
  },
  {
    id: "vite-react",
    name: "Vite + React + TS",
    description: "Modern React SPA with Vite, TypeScript, and HMR.",
    language: "typescript",
    icon: "Atom",
    files: [
      { path: "package.json", content: VITE_REACT_PKG },
      { path: "vite.config.ts", content: VITE_CONFIG },
      { path: "tsconfig.json", content: VITE_TSCONFIG },
      { path: "index.html", content: VITE_INDEX_HTML },
      { path: "src/main.tsx", content: VITE_MAIN },
      { path: "src/App.tsx", content: VITE_APP },
      { path: "src/index.css", content: VITE_CSS },
    ],
  },
  {
    id: "express-ts",
    name: "Express + TypeScript",
    description: "REST API server with Express, TypeScript, and tsx watch.",
    language: "typescript",
    icon: "Server",
    files: [
      { path: "package.json", content: EXPRESS_PKG },
      { path: "tsconfig.json", content: EXPRESS_TSCONFIG },
      { path: "src/index.ts", content: EXPRESS_INDEX },
    ],
  },
  {
    id: "flask-python",
    name: "Flask (Python)",
    description: "Minimal Flask web app with health route.",
    language: "python",
    icon: "Snake",
    files: [
      { path: "requirements.txt", content: FLASK_REQ },
      { path: "app.py", content: FLASK_APP },
    ],
  },
  {
    id: "static-html",
    name: "Static HTML/CSS/JS",
    description: "Plain HTML, CSS, and JavaScript — no build step.",
    language: "html",
    icon: "Globe",
    files: [
      { path: "index.html", content: STATIC_HTML },
      { path: "style.css", content: STATIC_CSS },
      { path: "script.js", content: STATIC_JS },
    ],
  },
  {
    id: "nextjs",
    name: "Next.js (App Router)",
    description: "Full-stack React framework with the App Router.",
    language: "typescript",
    icon: "Rocket",
    files: [
      { path: "package.json", content: NEXT_PKG },
      { path: "tsconfig.json", content: NEXT_TSCONFIG },
      { path: "app/layout.tsx", content: NEXT_LAYOUT },
      { path: "app/page.tsx", content: NEXT_PAGE },
    ],
  },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
