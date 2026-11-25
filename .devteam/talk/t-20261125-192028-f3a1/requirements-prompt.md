# Keep the requirements up to date

A developer is talking with an assistant about a feature. You do not talk to them. You quietly keep the written requirements up to date from what has been said, so that when they decide to build, the requirements are already agreed.

## The requirements so far

None yet. Start them from what was said below.

## What was said since you last looked

**Developer:** why is devteam not building revision 2

**Assistant:** Revision 1 finished and was saved, and DevTeam said it would go straight on to revision 2. Then the run ended and nothing started revision 2. I can see that this happened. I can't see why from the files.

What the files show:
- Revision 1 is Accepted (commit 73a21f3). Revision 2 (R6 to R10) is Pending, with auto-continue on, approved, and not paused (.devteam/series/a24447ad.json lines 39, 61, 70-72).
- At 19:03:29 the log says: 'Revision 1 passed and auto-continue is on: going on to the next without asking'. At 19:03:32 it says 'Feature complete'. That is the last event of the run (events.jsonl lines 438-445).
- The worker process then exited normally, with the run marked completed (workers.jsonl line 20). There is no later start in that file, and the runs index lists only the one run (runs-index.json).
- The request text for revision 2 is already written (.devteam/pending-request.md line 1: 'This is revision 2 of 2').

So revision 2 was prepared but never launched. My guess is that the auto-continue step queues the next run and a separate launcher has to pick it up, and that launcher did not. I haven't seen that part of DevTeam's code, so I don't know. I'd expect a new run folder or a worker 'spawned' line after 19:03:35 if something had picked it up, and there is none.

One more thing I can't confirm. The run's readiness is 'NotProven' (events.jsonl line 441). That may or may not be involved.

This is a question about DevTeam itself, not a feature of Tinkerdeck. I can't run commands here. The next thing to try is `devteam series` or `devteam status` in a terminal, and sending me what they print.

Do you want me to note this as the issue, or is there something else you wanted built?

## What the assistant has confirmed in the code

- Revision 1 is sealed and committed. Auto-continue to revision 2 was announced, but the run completed and the worker exited with no new run started.

## How to update

- Revise, do not restart. Keep every existing requirement id stable; add new ones after the highest. Change a requirement's words when the developer changed their mind; remove one only when they withdrew it.
- Write only what the developer said or clearly agreed to. Never invent a requirement. A topic is **answered** only when the developer said it, **assumed** only when you must choose a default (write it in 'assumptions'), **not-applicable** with a reason, otherwise **open**.
- It is normal for most topics to be open early on. Do not ask questions: leave 'ask' and 'questions' empty. Use the second shape below (the one that delivers requirements), even when topics are still open.
- Report every topic below in 'coverage'. A requirement may be unfinished (no acceptance yet) while it is being talked through.

### Topics

- **users**: Who uses this, and with which roles or permissions
- **data**: What information is stored: fields, formats, limits, uniqueness, required or optional
- **permissions**: Who may see or change which records (ownership, sharing)
- **validation**: What counts as invalid input, and what the person sees when it happens
- **states**: Empty, loading, error and success behaviour on every screen
- **duplicates**: Double submits, duplicates, and two people changing the same thing
- **volume**: How much data to expect: lists, searching, sorting, paging
- **deletion**: What deleting means (gone for good or recoverable) and what depends on it
- **privacy**: Personal or sensitive data: who may see it and how long it is kept
- **quality**: Non-functional expectations: security, accessibility, performance, reliability

## Write the result

Write one JSON object to `D:\work\nyingi\code\systems\lite-commander\.devteam\talk\t-20261125-192028-f3a1\requirements.json` and write nothing else, in this shape:

Either ask ONE question (when something important is still open):

{
  "summary": "",
  "requirements": [],
  "questions": [],
  "ask": {
    "text": "Should a customer be visible only to the user who added it, or to everyone who is signed in?",
    "why": "It decides who can see, change and delete each customer.",
    "topic": "permissions",
    "options": [
      { "label": "Only the user who added it", "consequence": "Each person has their own private list.", "recommended": true },
      { "label": "Everyone who is signed in", "consequence": "One shared list for the whole team." }
    ]
  },
  "coverage": [
    { "topic": "users", "status": "answered", "note": "" },
    { "topic": "permissions", "status": "open", "note": "" }
  ],
  "assumptions": []
}

Or, when no topic is open, deliver the requirements (written for a junior developer who knows the language but not this business):

{
  "summary": "One paragraph: what the feature does, for whom, and why.",
  "roles": ["Signed-in user: adds and looks up their own customers"],
  "requirements": [
    {
      "id": "R1",
      "text": "A signed-in user can create a customer with a name and an email address.",
      "rationale": "The business needs one place that says who its customers are, so nobody keeps their own list.",
      "acceptance": ["Saving with a valid name and email shows the customer in the list", "Saving without a name shows a message next to the name field"],
      "edgeCases": ["Pressing Save twice quickly creates only one customer", "An email that differs only in capital letters counts as the same email"],
      "pitfalls": ["A failed save must not leave a half-created customer behind"],
      "rules": ["API-003"],
      "facts": [{ "subject": "customer name", "attribute": "length", "op": "at-most", "value": "100", "unit": "characters" }]
    }
  ],
  "outOfScope": ["Importing customers from a file", "Sharing a customer with another user"],
  "nonFunctional": [
    { "area": "performance", "statement": "The customer list opens in under one second for 1,000 customers.", "acceptance": "A list of 1,000 customers renders in under 1 second." }
  ],
  "risks": ["Two people may add the same customer at the same time."],
  "tensions": [ { "requirements": ["R2", "R4"], "scenario": "Alice wants every customer on one page; Bob has ten thousand customers and needs the page to open in under a second." } ],
  "glossary": ["Customer: a person or business the company serves."],
  "questions": [],
  "coverage": [
    { "topic": "users", "status": "answered", "note": "" },
    { "topic": "volume", "status": "assumed", "note": "Up to a few hundred customers per user." },
    { "topic": "privacy", "status": "not-applicable", "note": "Only a name and a business email are stored." }
  ],
  "assumptions": ["A list shows 20 customers per page."]
}

Every requirement needs a rationale, at least one edge case and at least one acceptance criterion; 'rules' lists the house rule IDs that apply (only IDs from the rules shown above). Edge cases and pitfalls describe behaviour that must hold, never how to build it.
'tensions' lists only pairs of your own requirements that could plausibly pull in opposite directions (more of one means less of the other), each with a scenario of two or three sentences using the requirements' own subject matter and numbers; leave it empty when none do. Never list a pair just to be safe.
'coverage' must contain every topic listed above.
