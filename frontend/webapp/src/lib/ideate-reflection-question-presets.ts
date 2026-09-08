/**
 * Predefined Ideate reflection questions — direct, durable prompts.
 * Avoid calendar / “this week” framing; answers should stay meaningful over time.
 */

export type IdeateReflectionQuestionPreset = {
  id: string;
  text: string;
  description: string;
};

export const IDEATE_REFLECTION_QUESTION_PRESETS: readonly IdeateReflectionQuestionPreset[] =
  [
    {
      id: "regret",
      text: "What are you putting off that you’d regret never doing?",
      description: "Name the specific thing — not a vague ambition.",
    },
    {
      id: "who-there",
      text: "Who’s counting on you to follow through?",
      description: "A person, a team, or yourself — be concrete.",
    },
    {
      id: "avoiding",
      text: "What truth do you keep sidestepping?",
      description: "The one that would change your direction if you faced it.",
    },
    {
      id: "enough",
      text: "What does done look like — in one sentence?",
      description: "A clear finish line so you stop moving the goalposts.",
    },
    {
      id: "body-knows",
      text: "Where do you freeze when you try to start?",
      description: "The moment, the task, the fear — pin it down.",
    },
    {
      id: "real-choice",
      text: "If nothing were in the way, what would you choose?",
      description: "The honest preference — not the responsible compromise.",
    },
    {
      id: "excuse",
      text: "What’s the excuse you keep reusing?",
      description: "Write it plainly, then decide if it still holds.",
    },
    {
      id: "tradeoff",
      text: "What are you willing to give up to make this real?",
      description: "Time, comfort, status, money — pick something concrete.",
    },
    {
      id: "evidence",
      text: "What evidence do you already have that you can do this?",
      description: "Past wins, skills, allies — list what’s true.",
    },
    {
      id: "nonnegotiable",
      text: "What part of this is non-negotiable?",
      description: "The core you won’t dilute to make it easier.",
    },
    {
      id: "cost-of-not",
      text: "What does not doing this cost you?",
      description: "Be specific: money, health, relationships, self-respect.",
    },
    {
      id: "saying-no",
      text: "What do you need to say no to so this can happen?",
      description: "A commitment, habit, or person — name it.",
    },
    {
      id: "help",
      text: "Who could help — and what’s stopping you asking?",
      description: "The blocker is usually pride, timing, or fear of a no.",
    },
    {
      id: "success-looks",
      text: "How will you know you’ve succeeded?",
      description: "A clear, observable sign — not a vague feeling.",
    },
  ] as const;
