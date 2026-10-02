# Running the studio

Install Node.js 24, run npm ci, and install Chromium with npx playwright install chromium. Copy .env.example to .env.local only when the private file does not already exist. Configure OPENROUTER_API_KEY in .env.local. Never put a provider key in client-side code or a NEXT_PUBLIC_ variable.

Start the web application and persistent generation worker together with npm run dev. Open http://localhost:3000. Wait for the worker ready message before generating. Restart the application after editing .env.local. An OpenRouter key is necessary for reference inspection, generation, and AI refinement.
