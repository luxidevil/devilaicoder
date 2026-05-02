import type { ProjectTemplate } from '../types';

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'react-vite',
    name: 'React + Vite',
    description: 'Modern React app with Vite, TypeScript, and Tailwind CSS',
    language: 'typescript',
    icon: '⚛️',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "react-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.2.0",
    "vite": "^5.1.0"
  }
}`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`,
      },
      {
        path: 'src/App.tsx',
        content: `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
          React App
        </h1>
        <p className="text-gray-400">Edit src/App.tsx and start building</p>
        <button
          onClick={() => setCount(c => c + 1)}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
        >
          count is {count}
        </button>
      </div>
    </div>
  )
}

export default App`,
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
      },
      {
        path: 'tailwind.config.js',
        content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}`,
      },
    ],
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    description: 'Full-stack React framework with App Router and TypeScript',
    language: 'typescript',
    icon: '▲',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "nextjs-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.1.0",
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    "postcss": "^8",
    "tailwindcss": "^3.3.0",
    "typescript": "^5"
  }
}`,
      },
      {
        path: 'app/layout.tsx',
        content: `import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Next.js App',
  description: 'Built with Next.js',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}`,
      },
      {
        path: 'app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          Next.js App
        </h1>
        <p className="text-gray-400">Edit app/page.tsx to get started</p>
      </div>
    </main>
  )
}`,
      },
      {
        path: 'app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;`,
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config`,
      },
      {
        path: 'next.config.js',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig`,
      },
    ],
  },
  {
    id: 'python-flask',
    name: 'Python Flask',
    description: 'Lightweight Python web API with Flask',
    language: 'python',
    icon: '🐍',
    files: [
      {
        path: 'app.py',
        content: `from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route('/')
def index():
    return jsonify({'message': 'Hello from Flask!', 'status': 'ok'})


@app.route('/api/health')
def health():
    return jsonify({'status': 'healthy'})


@app.route('/api/echo', methods=['POST'])
def echo():
    data = request.get_json()
    return jsonify({'received': data})


if __name__ == '__main__':
    app.run(debug=True, port=5000)`,
      },
      {
        path: 'requirements.txt',
        content: `flask==3.0.0
flask-cors==4.0.0`,
      },
      {
        path: 'README.md',
        content: `# Flask API

## Setup

\`\`\`bash
pip install -r requirements.txt
python app.py
\`\`\`

The server runs at http://localhost:5000

## Endpoints

- \`GET /\` — Hello world
- \`GET /api/health\` — Health check
- \`POST /api/echo\` — Echo request body`,
      },
    ],
  },
  {
    id: 'node-express',
    name: 'Node.js Express',
    description: 'Fast Node.js REST API with Express and TypeScript',
    language: 'typescript',
    icon: '🟢',
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "express-api",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.3"
  }
}`,
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express!', status: 'ok' })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() })
})

app.post('/api/echo', (req, res) => {
  res.json({ received: req.body })
})

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`)
})`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}`,
      },
    ],
  },
  {
    id: 'html-css-js',
    name: 'HTML / CSS / JS',
    description: 'Simple vanilla web project, no frameworks',
    language: 'javascript',
    icon: '🌐',
    files: [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Website</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="container">
    <h1>Hello World</h1>
    <p>Edit index.html, style.css, and script.js to build your site.</p>
    <button id="btn">Click me</button>
    <p id="output"></p>
  </div>
  <script src="script.js"></script>
</body>
</html>`,
      },
      {
        path: 'style.css',
        content: `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0f0f0f;
  color: #e5e5e5;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  text-align: center;
  max-width: 600px;
  padding: 2rem;
}

h1 {
  font-size: 3rem;
  font-weight: 700;
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 1rem;
}

p { color: #9ca3af; margin-bottom: 1.5rem; }

button {
  padding: 0.75rem 2rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover { background: #2563eb; }

#output { margin-top: 1rem; color: #06b6d4; font-weight: 500; }`,
      },
      {
        path: 'script.js',
        content: `const btn = document.getElementById('btn')
const output = document.getElementById('output')
let count = 0

btn.addEventListener('click', () => {
  count++
  output.textContent = \`Button clicked \${count} time\${count !== 1 ? 's' : ''}!\`
})`,
      },
    ],
  },
  {
    id: 'python-cli',
    name: 'Python CLI',
    description: 'Python command-line tool with argument parsing',
    language: 'python',
    icon: '⌨️',
    files: [
      {
        path: 'main.py',
        content: `#!/usr/bin/env python3
"""
A Python CLI tool.
"""
import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description='My CLI Tool')
    parser.add_argument('--name', type=str, default='World', help='Name to greet')
    parser.add_argument('--count', type=int, default=1, help='Number of times to greet')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    args = parser.parse_args()

    if args.verbose:
        print(f'Running with name={args.name}, count={args.count}')

    for i in range(args.count):
        print(f'Hello, {args.name}!')


if __name__ == '__main__':
    main()`,
      },
      {
        path: 'requirements.txt',
        content: `# Add your dependencies here`,
      },
      {
        path: 'README.md',
        content: `# Python CLI Tool

## Usage

\`\`\`bash
python main.py --name Alice --count 3
python main.py --verbose
\`\`\``,
      },
    ],
  },
];
