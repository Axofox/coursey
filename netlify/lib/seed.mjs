/*
  First-run content, matching the Coursehub design handoff so the site
  isn't empty on day one. Everything here is editable (or deletable) from
  the admin console.
*/

export const SEED_CATEGORIES = [
  { id: "design",      name: "Design",      description: "UX, UI, and product design.",            icon_bg: "#EDEBFB", icon_color: "#7A6DF0" },
  { id: "development", name: "Development", description: "Web, mobile, and backend engineering.",  icon_bg: "#E3F1FB", icon_color: "#3E93C9" },
  { id: "business",    name: "Business",    description: "Strategy, management, and finance.",      icon_bg: "#FDEEDC", icon_color: "#C98A3E" },
  { id: "marketing",   name: "Marketing",   description: "Brand, growth, and storytelling.",        icon_bg: "#FBE7EC", icon_color: "#C9698A" },
  { id: "data",        name: "Data",        description: "Analytics, SQL, and machine learning.",   icon_bg: "#E4F3EA", icon_color: "#3E9C6B" },
  { id: "photography", name: "Photography", description: "Camera craft, lighting, and editing.",   icon_bg: "#FFF6DD", icon_color: "#B79A2E" },
];

const lesson = (title, duration) => ({ title, duration });
// The first lesson of every course is a free preview so the player has something to show.
const previewFirst = (curriculum) => {
  const first = curriculum[0] && curriculum[0].lessons[0];
  if (first) first.preview = true;
  return curriculum;
};

export const SEED_COURSES = [
  {
    category_id: "design",
    title: "UX Foundations: Research to Wireframe",
    subtitle: "A practical, project-based path through user research, information architecture and wireframing — build a real portfolio case study as you go.",
    description: "",
    instructor_name: "Maya Chen",
    instructor_title: "Product Designer at Figma",
    instructor_bio: "10 years designing consumer products at Figma and Airbnb. Maya has taught over 40,000 students across 9 courses on UX process and craft.",
    level: "Intermediate",
    price: 49, original_price: 89, badge: "Bestseller",
    rating: 4.9, rating_count: 2104, students: 18240, resources: 14, featured: true,
    learn: [
      "Plan and run a lightweight user research study",
      "Turn findings into a clear information architecture",
      "Sketch and wireframe screens with intent",
      "Build a portfolio-ready UX case study",
      "Critique and iterate on your own work",
      "Hand off wireframes a developer can build from",
    ],
    requirements: [
      "No prior design experience needed",
      "A free Figma account (we'll walk you through setup)",
    ],
    curriculum: previewFirst([
      { title: "Getting started", lessons: [
        lesson("Welcome & how this course works", "4:20"), lesson("Setting up Figma", "9:10"),
        lesson("The UX process, end to end", "11:40"), lesson("Meet your case study brief", "6:50") ] },
      { title: "User research", lessons: [
        lesson("Planning a research study", "12:00"), lesson("Writing an interview script", "14:30"),
        lesson("Conducting interviews", "18:20"), lesson("Synthesizing findings", "16:00") ] },
      { title: "Information architecture", lessons: [
        lesson("Card sorting basics", "10:10"), lesson("Building a sitemap", "13:40"),
        lesson("User flows", "15:00"), lesson("Validating structure", "9:50") ] },
      { title: "Wireframing", lessons: [
        lesson("Low-fidelity sketching", "11:00"), lesson("Wireframing in Figma", "19:30"),
        lesson("Responsive layouts", "14:10"), lesson("Handoff-ready wireframes", "12:40") ] },
    ]),
  },
  {
    category_id: "data",
    title: "Python for Data Analysis",
    subtitle: "Go from zero to confident with pandas, NumPy and real datasets — no computer science degree required.",
    instructor_name: "Daniel Ortiz", instructor_title: "Senior Data Scientist",
    instructor_bio: "Daniel leads analytics at a fintech scale-up and has taught Python to more than 60,000 learners.",
    level: "Beginner", price: 54, original_price: 99, badge: "Bestseller",
    rating: 4.8, rating_count: 5320, students: 31400, resources: 22, featured: true,
    learn: ["Load, clean and reshape real-world datasets with pandas", "Answer business questions with groupbys and joins", "Visualize results that people actually understand"],
    requirements: ["A laptop that can run Python 3", "No prior programming experience needed"],
    curriculum: previewFirst([
      { title: "Python essentials", lessons: [lesson("Installing Python & Jupyter", "8:30"), lesson("Variables, lists and loops", "15:10"), lesson("Functions you'll reuse", "12:00")] },
      { title: "Working with pandas", lessons: [lesson("DataFrames from CSV and Excel", "14:20"), lesson("Filtering and sorting", "11:45"), lesson("Group, aggregate, pivot", "18:00")] },
      { title: "Your first analysis project", lessons: [lesson("Framing the question", "9:00"), lesson("Cleaning messy data", "16:30"), lesson("Presenting findings", "10:15")] },
    ]),
  },
  {
    category_id: "data",
    title: "The Complete SQL Bootcamp",
    subtitle: "Write the queries analysts and engineers use every day — from SELECT to window functions.",
    instructor_name: "Priya Nair", instructor_title: "Analytics Engineer",
    instructor_bio: "Priya builds data platforms for e-commerce teams and has run SQL workshops for over a decade.",
    level: "Beginner", price: 44, original_price: 79,
    rating: 4.7, rating_count: 3860, students: 22900, resources: 18, featured: true,
    learn: ["Query and join tables with confidence", "Aggregate and filter with GROUP BY and HAVING", "Use window functions for rankings and running totals"],
    requirements: ["No prior SQL or database experience needed"],
    curriculum: previewFirst([
      { title: "SQL basics", lessons: [lesson("How databases think", "7:40"), lesson("SELECT, WHERE, ORDER BY", "13:20"), lesson("Joins explained visually", "16:10")] },
      { title: "Beyond the basics", lessons: [lesson("Aggregations", "12:00"), lesson("Subqueries and CTEs", "14:50"), lesson("Window functions", "17:30")] },
    ]),
  },
  {
    category_id: "marketing",
    title: "Brand Strategy & Positioning",
    subtitle: "Define what your brand stands for, who it's for, and why anyone should care.",
    instructor_name: "Owen Fisk", instructor_title: "Brand Strategist",
    instructor_bio: "Owen has positioned brands at agencies and start-ups for 12 years, from seed stage to IPO.",
    level: "Intermediate", price: 59, original_price: 99, badge: "New",
    rating: 4.9, rating_count: 980, students: 4300, resources: 9, featured: true,
    learn: ["Write a positioning statement that holds up", "Map competitors and find white space", "Turn strategy into a messaging framework"],
    requirements: ["A brand (yours or a client's) to work on during the course"],
    curriculum: previewFirst([
      { title: "Foundations", lessons: [lesson("What positioning really is", "9:30"), lesson("Audience and jobs-to-be-done", "14:00"), lesson("Competitive mapping", "12:20")] },
      { title: "Building the strategy", lessons: [lesson("Writing the positioning statement", "15:40"), lesson("Messaging hierarchy", "13:10"), lesson("Testing with real customers", "11:00")] },
    ]),
  },
  {
    category_id: "business",
    title: "Product Management 101",
    subtitle: "The core toolkit of a product manager: discovery, prioritisation, roadmaps and shipping.",
    instructor_name: "Sara Kim", instructor_title: "Group Product Manager",
    instructor_bio: "Sara has led product teams at two unicorns and mentors PMs moving into their first role.",
    level: "Beginner", price: 49, original_price: 89,
    rating: 4.6, rating_count: 1540, students: 9800, resources: 11, featured: true,
    learn: ["Run discovery interviews that surface real problems", "Prioritise with frameworks that survive contact with reality", "Write specs engineers want to read"],
    requirements: ["No prior product experience needed"],
    curriculum: previewFirst([
      { title: "What PMs actually do", lessons: [lesson("The role, demystified", "10:00"), lesson("Working with engineering and design", "12:30")] },
      { title: "Discovery to delivery", lessons: [lesson("Customer interviews", "15:20"), lesson("Prioritisation", "13:40"), lesson("Roadmaps that don't lie", "11:50")] },
    ]),
  },
  {
    category_id: "business",
    title: "Advanced Excel for Finance",
    subtitle: "Financial modelling, scenario analysis and dashboards — the Excel skills finance teams hire for.",
    instructor_name: "Tom Reilly", instructor_title: "Financial Modelling Consultant",
    instructor_bio: "Tom builds models for private equity and teaches Excel to analysts at three investment banks.",
    level: "Advanced", price: 39, original_price: 69,
    rating: 4.8, rating_count: 2760, students: 14100, resources: 26, featured: true,
    learn: ["Build a three-statement financial model from scratch", "Run scenario and sensitivity analysis", "Design dashboards executives can read"],
    requirements: ["Comfortable with basic Excel formulas", "Excel 2019 or Microsoft 365"],
    curriculum: previewFirst([
      { title: "Modelling foundations", lessons: [lesson("Model structure and conventions", "11:10"), lesson("Lookups and dynamic ranges", "14:40")] },
      { title: "The three-statement model", lessons: [lesson("Income statement", "16:00"), lesson("Balance sheet", "15:30"), lesson("Cash flow", "13:20")] },
      { title: "Analysis", lessons: [lesson("Scenario tables", "12:10"), lesson("Sensitivity analysis", "10:50"), lesson("Dashboards", "14:00")] },
    ]),
  },
  {
    category_id: "design",
    title: "Figma to Front-End Handoff",
    subtitle: "Ship designs developers can build without a dozen follow-up questions.",
    instructor_name: "Maya Chen", instructor_title: "Product Designer at Figma",
    instructor_bio: "10 years designing consumer products at Figma and Airbnb. Maya has taught over 40,000 students across 9 courses on UX process and craft.",
    level: "Intermediate", price: 54, original_price: 89, badge: "Bestseller",
    rating: 4.9, rating_count: 1120, students: 6700, resources: 12, featured: true,
    learn: ["Structure files with components, variants and tokens", "Annotate behaviour, states and edge cases", "Use Dev Mode to hand off cleanly"],
    requirements: ["Basic Figma skills", "A free Figma account"],
    curriculum: previewFirst([
      { title: "File hygiene", lessons: [lesson("Naming and structure", "8:20"), lesson("Components and variants", "15:00"), lesson("Design tokens", "12:40")] },
      { title: "Handoff", lessons: [lesson("Annotating states", "11:30"), lesson("Dev Mode walkthrough", "13:50"), lesson("Reviewing the build", "9:40")] },
    ]),
  },
  {
    category_id: "data",
    title: "Intro to Machine Learning",
    subtitle: "Understand and build your first models with scikit-learn — intuition first, maths second.",
    instructor_name: "Daniel Ortiz", instructor_title: "Senior Data Scientist",
    instructor_bio: "Daniel leads analytics at a fintech scale-up and has taught Python to more than 60,000 learners.",
    level: "Intermediate", price: 64, original_price: 109,
    rating: 4.7, rating_count: 4010, students: 19600, resources: 16, featured: true,
    learn: ["Explain when machine learning is (and isn't) the right tool", "Train and evaluate classification and regression models", "Avoid the classic mistakes: leakage, overfitting, bad metrics"],
    requirements: ["Basic Python (the Python for Data Analysis course is a good start)"],
    curriculum: previewFirst([
      { title: "How ML works", lessons: [lesson("Learning from data", "10:30"), lesson("Train, validate, test", "12:00")] },
      { title: "First models", lessons: [lesson("Linear regression", "14:20"), lesson("Classification with trees", "16:10"), lesson("Evaluating models honestly", "13:00")] },
    ]),
  },
];

// The three bundles from the design, built from the courses above.
export const SEED_BUNDLES = [
  {
    name: "Product Design Career Path",
    description: "Everything from first research study to developer handoff.",
    price: 89,
    courses: ["UX Foundations: Research to Wireframe", "Figma to Front-End Handoff", "Brand Strategy & Positioning"],
  },
  {
    name: "Data Analyst Starter Bundle",
    description: "SQL, Python and a first look at machine learning.",
    price: 119,
    courses: ["The Complete SQL Bootcamp", "Python for Data Analysis", "Intro to Machine Learning"],
  },
  {
    name: "Business Foundations Set",
    description: "Product thinking and the numbers behind it.",
    price: 69,
    courses: ["Product Management 101", "Advanced Excel for Finance"],
  },
];

/*
  Learner-setup test course content: checkpoint questions and track-tagged
  exercises for "UX Foundations: Research to Wireframe", one entry per section.
  Applied by the seed on fresh databases and by migration 006 on existing ones.
*/
const mc = (prompt, options, answer, explanation = "") => ({ prompt, options, answer, explanation });
export const TEST_COURSE_TITLE = "UX Foundations: Research to Wireframe";
export const TEST_COURSE_CONTENT = [
  { // 1. Getting started
    quiz: [
      mc("What is the main outcome you build across this course?", ["A style guide", "A portfolio-ready UX case study", "A coded prototype", "A marketing site"], 1, "Every section feeds the case study."),
      mc("In the UX process taught here, what comes first?", ["Wireframing", "Visual design", "User research", "Handoff"], 2),
      mc("Which tool do you set up in section 1?", ["Sketch", "Figma", "Framer", "Illustrator"], 1),
      mc("Why start from a case study brief?", ["It replaces research", "It gives every exercise a real context", "It's required by Figma", "It shortens the course"], 1),
    ],
    exercises: [
      { track: "job_ready", title: "Write a one-page project brief", body: "Draft a brief for a real product you'd like in your portfolio: problem, audience, success metric, constraints. Aim for something a stakeholder could sign off." },
      { track: "project", title: "Pick your case-study product", body: "Choose one product idea and write three sentences: who it's for, what it does, what 'done' looks like for this course. Keep it small enough to finish." },
      { track: "exploring", title: "Map the UX process", body: "In your own words, list the stages of the UX process from the lesson and one question you have about each." },
    ],
  },
  { // 2. User research
    quiz: [
      mc("What makes a good interview question?", ["It suggests the answer you want", "It asks about past behaviour, not hypotheticals", "It's a yes/no question", "It's about the competitor"], 1, "Ask what people did, not what they would do."),
      mc("How many interviews does the course suggest for a lightweight study?", ["1–2", "5–8", "50+", "As many as possible"], 1),
      mc("What is the goal of synthesis?", ["To transcribe everything", "To turn notes into patterns and insights", "To pick the best participant", "To write the final report"], 1),
      mc("A research plan should state:", ["Only the questions", "Goal, participants, method and what you'll decide", "The wireframes", "The brand colours"], 1),
    ],
    exercises: [
      { track: "job_ready", title: "Run two real interviews", body: "Recruit two people from your target audience, run 20-minute interviews with your script, and write a one-page synthesis with three insights and the evidence for each." },
      { track: "project", title: "Interview one person", body: "Run a single 15-minute interview about your product idea and capture the three most surprising things you heard." },
      { track: "exploring", title: "Critique an interview script", body: "Take the sample script from the lesson and mark every leading or hypothetical question. Rewrite two of them." },
    ],
  },
  { // 3. Information architecture
    quiz: [
      mc("Card sorting helps you discover:", ["Colour preferences", "How users group and label content", "Which font to use", "Server structure"], 1),
      mc("A sitemap shows:", ["The visual style", "The hierarchy of pages/screens", "The database schema", "The team structure"], 1),
      mc("A user flow answers:", ["What the page looks like", "The steps a user takes to reach a goal", "Who the stakeholders are", "How much it costs"], 1),
      mc("How do you validate an IA before wireframing?", ["Ship it", "Tree testing or a quick task test with users", "Ask the CEO", "Pick the shortest sitemap"], 1),
    ],
    exercises: [
      { track: "job_ready", title: "Sitemap + two validated flows", body: "Produce a sitemap for your product and two key user flows. Test them with two people using tree-testing style tasks and note what you changed." },
      { track: "project", title: "Sketch the sitemap", body: "Draw your product's sitemap on one page and the single most important user flow, start to goal." },
      { track: "exploring", title: "Reverse-engineer an IA", body: "Pick an app you use daily and sketch its sitemap from memory. Where does its structure surprise you?" },
    ],
  },
  { // 4. Wireframing
    quiz: [
      mc("Why sketch low-fidelity first?", ["Stakeholders prefer it", "It's cheap to explore many layouts before committing", "Figma requires it", "It looks finished"], 1),
      mc("A responsive wireframe should show:", ["Only desktop", "Key breakpoints and how content reflows", "Final colours", "Animations"], 1),
      mc("What makes a wireframe handoff-ready?", ["Pixel-perfect visuals", "Annotated states, flows and edge cases a developer can build from", "A PDF export", "A logo"], 1),
      mc("Which of these belongs in wireframe annotations?", ["Brand tagline", "What happens on error and empty states", "Marketing copy", "Font licensing"], 1),
    ],
    exercises: [
      { track: "job_ready", title: "Handoff-ready wireframes", body: "Wireframe the two key flows at mobile and desktop, annotate states and edge cases, and share a Figma link a developer could build from. Add it to your case study." },
      { track: "project", title: "Wireframe the happy path", body: "Wireframe the main flow of your product at one breakpoint and mark the three screens you'd build first." },
      { track: "exploring", title: "Annotate an existing screen", body: "Take a screenshot of any app screen and annotate its states: loading, empty, error, success." },
    ],
  },
];

// Merges the test-course content into a curriculum (sections without questions/exercises only).
export function withTestCourseContent(curriculum) {
  return curriculum.map((s, i) => {
    const c = TEST_COURSE_CONTENT[i];
    if (!c) return s;
    return { ...s, quiz: (s.quiz || []).length ? s.quiz : c.quiz, exercises: (s.exercises || []).length ? s.exercises : c.exercises };
  });
}
