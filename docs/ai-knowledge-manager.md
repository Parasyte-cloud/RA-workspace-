# AI Knowledge Manager

Admin only. Administration, then **AI Management**.

## What it does
Researches RideArrivo with web search plus the current Knowledge Base, then queues proposed new or corrected articles. An admin approves or rejects each one. Nothing reaches staff before approval.

## One-time setup
1. `supabase db push` (adds the review queue, run log, settings, approve function, and 16 starter articles; re-running never overwrites edited articles).
2. `supabase secrets set ANTHROPIC_API_KEY=<key>` (create the key in the Anthropic Console and enable web search for the organisation there). Optional: `KNOWLEDGE_AI_MODEL` (default `claude-sonnet-5-5`).
3. `supabase functions deploy knowledge-ai`.
4. Check: `supabase/checks/knowledge-ai-behaviour.sql` (every line ends in `t`).

## Guard rails
- Only active employees with role `admin` can call the function.
- One run at a time, 12 runs per 24 hours, at most 6 web searches per run, 6 proposals per run.
- Citations are kept only if the search tool returned that URL (or it is a ridearrivo.com page).
- The function never writes articles. Only `decide_knowledge_ai_proposal` (admin, row locked) does.
- Article text is rendered without HTML, so drafted text cannot inject markup.
