# Orbit AI

A small, fictional project-management app: sign in, name a workspace, pick a
workflow, and get a four-stage board (Brief, Build, Review, Handoff) with sample
tasks. You can add tasks and move them between stages, and everything is saved
per account in a local SQLite database.

It is built with Next.js, React, Clerk sign-in, and Node's built-in SQLite. There
are no real invitations, payments, uploads, or customer data.

This is the **starter** for the Synthesia Interactive Avatars build video. It
includes a male-voiced Synthesia onboarding guide in a bottom-right widget,
backed by a separate Python LiveKit worker. The guide can navigate the app and
add or move tasks through the real task controls, then reports success only
after the save is confirmed. Part 1 gets the workspace app running. Part 2
explains the guide's credentials and how the video extends it. Product answers
use retrieval-augmented generation (RAG) over the Markdown files in
[`docs/product`](docs/product); the avatar model is not fine-tuned.

## Part 1. Run the app

You need [Node 24](https://nodejs.org) or newer and a free [Clerk](https://go.clerk.com/sonny) account.

1. Clone and install.

   ```sh
   git clone https://github.com/sonnysangha/launchpad-starter.git
   cd launchpad-starter
   npm ci
   ```

2. Get your Clerk keys. [Sign up for Clerk](https://go.clerk.com/sonny), then in the Clerk dashboard create an application, open **API keys**, and copy the publishable key and secret key. Use the **development** keys.

3. Copy `.env.example` to `.env.local` and paste your Clerk development keys and LiveKit credentials in. The LiveKit credentials are used by the app's authenticated guide-token route.

   ```sh
   cp .env.example .env.local
   ```

4. Check your configuration, then start the app.

   ```sh
   npm run preflight
   npm run dev
   ```

5. Open <http://127.0.0.1:3212>. Use this exact address, because sign-in and the API only accept requests from it. Create an account and set up your workspace, and you land on the board.

The database lives in `.data/launchpad.sqlite`, which is git-ignored. Each signed-in account has its own isolated workspace. To start over, open **Reset demo workspace** at the bottom of the board and type `RESET`.

## Part 2. Run and extend the AI onboarding guide

The guide talks users through workspace setup and can navigate the app using
its real Setup, Preview, Board, List, People, and Help center buttons. In a
saved project, it can add tasks with **New task** or move a uniquely identified
task with **Move task**. It confirms either action only after the browser
receives and validates the app's saved-task receipt. For factual product
questions, the guide retrieves matching document passages and cites the source
filename in its spoken answer.

### What you need

- A coding agent that supports skills, such as Codex or Claude Code
- [Python](https://www.python.org/downloads/) 3.12 or newer (the video used 3.13)
- A microphone, and Chrome or another modern browser

### 1. Install the skills

Run these in the project folder. They give your coding agent the official Synthesia and LiveKit instructions, so it reads the real docs instead of guessing.

```sh
npx skills add synthesia-ai/skills
npx skills add livekit/agent-skills
```

Sources: Synthesia's [Interactive Avatars page](https://www.synthesia.io/features/avatars/interactive-avatars?utm_source=youtube&utm_medium=creator&utm_campaign=interactive_avatar_api&utm_content=sonny) ("Let your coding agent handle integration") and LiveKit's [Agent Skills docs](https://docs.livekit.io/reference/developer-tools/agent-skills/).

### 2. Get your keys

| Key | Where to get it |
| --- | --- |
| LiveKit URL, API key, API secret | Create a free project on [LiveKit Cloud](https://cloud.livekit.io). It also runs Cartesia for speech, so you don't need a separate Cartesia key. |
| Synthesia account | [Sign up for Synthesia Interactive Avatars](https://www.synthesia.io/features/avatars/interactive-avatars?utm_source=youtube&utm_medium=creator&utm_campaign=interactive_avatar_api&utm_content=sonny). |
| Synthesia API key | [Create your API key](https://docs.synthesia.io/reference/synthesia-api-quickstart#create-your-api-key). Your plan needs Interactive Avatars. |
| Synthesia avatar | The guide uses the Kenji Interactive Avatar ID by default. Change `AVATAR_ID` in `agent/agent.py` only if your workspace has another usable Interactive Avatar ID. |
| OpenAI API key | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Keep `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the root `.env.local` (or root `.env`); the app needs them to mint a room token. Copy `agent/.env.example` to `agent/.env` and put only `SYNTHESIA_API_KEY` and `OPENAI_API_KEY` there:

```sh
cp agent/.env.example agent/.env
```

The Python worker reads the root LiveKit env file and its own agent env file. Both `.env` files are git-ignored. Never put a server secret in a `NEXT_PUBLIC_` variable.

### 3. Try the guide's product-doc RAG

The integration follows Synthesia's [minimal quickstart](https://docs.synthesia.io/reference/interactive-avatar-minimal-quickstart): a Python LiveKit agent with an avatar attached. The worker searches `docs/product` when the user asks a factual product question, passes the best-matching passages to the model, and instructs it to answer only from those passages. No vector database or model fine-tuning is involved.

Two documents are synthetic fixtures for checking retrieval and citations:

- `docs/product/07-rag-test-workspace.md`: Juniper & Finch Studio, Portland, 9 people, code **MINT-42**.
- `docs/product/08-rag-test-project.md`: Moonlight Catalog, owned by Mara Vale, launches May 14, sample budget **3,400 demo credits**.

After starting the app and guide, try asking:

- "What's Juniper and Finch Studio's workspace code?" Expected: **MINT-42**, citing `07-rag-test-workspace.md`.
- "How many people are on the Juniper and Finch team?" Expected: **9 people**, citing `07-rag-test-workspace.md`.
- "Who owns the Moonlight Catalog project?" Expected: **Mara Vale**, citing `08-rag-test-project.md`.
- "What's the Moonlight Catalog's sample budget?" Expected: **3,400 demo credits**, citing `08-rag-test-project.md`.
- "Who won the 2040 moon cheese championship?" Expected: the guide says the product docs don't contain that information instead of guessing.

These fixture facts are fictional and are not customer data. Add or update Markdown files in `docs/product` to change what the guide can retrieve; the worker reads documents on each search.

Want to compare with the finished version from the video? It's at [launchpad-ai-guide](https://github.com/sonnysangha/launchpad-ai-guide).

### 4. Run it

The Python agent is a separate worker that sits next to the app. The app gives your browser a LiveKit room, and the worker joins the same room and brings the avatar with it. Install the worker dependencies once:

```sh
uv sync --project agent
```

Then start the app and worker in separate terminals:

```sh
npm run dev
uv run --project agent python agent/agent.py dev
```

Open the board, start a conversation with the guide, and wait for its greeting. Then try:

- "I just signed up and I'm a bit lost. Where do I start?"
- Interrupt it: "Wait, show me Review."
- "What happens next?"
- "Add a task called Design homepage."
- "Move Design homepage to Build."

Refresh afterwards, and the tasks are still there.

Every conversation uses your LiveKit, Synthesia and OpenAI usage, so end the conversation when you're done.

## Synthesia docs to get started

- [Interactive Avatars overview](https://docs.synthesia.io/reference/interactive-avatars): what they are and how they work
- [Concepts](https://docs.synthesia.io/reference/ia-concepts): how a LiveKit agent attaches the avatar, the session lifecycle, and a glossary
- [Integration overview](https://docs.synthesia.io/reference/ia-overview): the pieces you connect and what each one does
- [Minimal quickstart](https://docs.synthesia.io/reference/interactive-avatar-minimal-quickstart): the starting point for this project
- [Tools quickstart](https://docs.synthesia.io/reference/interactive-avatar-tools-quickstart): an avatar that fills in a form as you talk
- [RAG quickstart](https://docs.synthesia.io/reference/interactive-avatar-rag-quickstart): an avatar that answers from your own documents
- [LiveKit plugin reference](https://docs.synthesia.io/reference/ia-livekit-plugin-reference)
- [Quickstart source code on GitHub](https://github.com/synthesia-ai/interactive-avatar-quickstarts)

## What's in here

| Path | What it is |
| --- | --- |
| `src/app` | Pages (landing, sign-in, onboarding, dashboard) and API routes |
| `src/app/api` | `workspace` (create/read), `guide/token` (authenticated LiveKit room), `tasks` (add), `tasks/stage` (move), `reset` |
| `src/components` | Onboarding form, bottom-right voice guide, board/list views, New task form, Move task panel |
| `agent` | Separate Python LiveKit worker, product-doc retrieval, and agent tests |
| `src/lib/store.ts` | SQLite store; every read and write is scoped to the signed-in user |
| `src/lib/contracts.ts` | Shared input validation (zod) |
| `docs/product` | Product handbook and two synthetic RAG test documents |
| `DESIGN.md` | Visual design notes |

Adding and moving tasks are idempotent: each save carries a request ID, so a
retry after a lost response never creates a duplicate or repeats a move.

## Checks

```sh
npm run typecheck
npm test
npm run build
node scripts/check-client-secrets.mjs   # after a build: no server secret in browser assets
```

Browser checks are described in [`e2e/README.md`](e2e/README.md).
