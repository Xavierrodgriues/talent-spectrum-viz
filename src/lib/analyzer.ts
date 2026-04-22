export type Skill = {
  name: string;
  score: number;
  min: number;
  max: number;
};

export type AnalysisResult = {
  role: string;
  years: number;
  level: string;
  skills: Skill[];
  feedback: string[];
  covered: string[];
  gaps: string[];
  resumePoints: string[];
};

const ROLE_PROFILES: Record<
  string,
  { skills: string[]; covered: string[]; gaps: string[]; feedbackBase: string[]; bullets: string[] }
> = {
  "DevOps Engineer": {
    skills: ["GitHub Actions", "Docker", "Kubernetes", "AWS", "Terraform", "Linux"],
    covered: ["CI/CD pipelines", "Cloud deployment", "Container orchestration basics"],
    gaps: ["Advanced Kubernetes scaling", "Infrastructure as Code best practices at scale", "Service mesh & observability"],
    feedbackBase: [
      "Strong alignment with CI/CD pipeline automation and cloud infrastructure.",
      "Experience lacks depth in large-scale Kubernetes orchestration.",
      "Expected ownership of infrastructure scalability and monitoring systems.",
    ],
    bullets: [
      "Designed and optimized CI/CD pipelines reducing deployment time by 35%.",
      "Managed AWS infrastructure supporting 99.9% uptime across 20+ services.",
      "Automated container workflows using Docker and Kubernetes for 50+ microservices.",
      "Implemented Terraform modules enabling reproducible multi-region deployments.",
      "Reduced cloud spend by 22% through rightsizing and reserved capacity planning.",
      "Built observability stack with Prometheus and Grafana for proactive alerting.",
    ],
  },
  "Frontend Engineer": {
    skills: ["React", "TypeScript", "CSS / Tailwind", "Testing", "Performance", "Accessibility"],
    covered: ["Component architecture", "State management", "Responsive design"],
    gaps: ["Advanced performance profiling", "WCAG AA accessibility depth", "Micro-frontend architecture"],
    feedbackBase: [
      "Solid command of modern React patterns and design systems.",
      "Could strengthen performance budgeting and Core Web Vitals ownership.",
      "Expected leadership on accessibility and UX engineering standards.",
    ],
    bullets: [
      "Led migration to React + TypeScript, cutting runtime errors by 40%.",
      "Built reusable design system adopted across 6 product teams.",
      "Improved Lighthouse performance score from 62 to 94 on main app.",
      "Implemented E2E testing with Playwright, raising coverage to 85%.",
      "Shipped accessibility improvements achieving WCAG 2.1 AA compliance.",
      "Mentored 4 junior engineers on React and frontend best practices.",
    ],
  },
  "Backend Engineer": {
    skills: ["Node.js / Go", "Databases", "API Design", "System Design", "Caching", "Security"],
    covered: ["REST API design", "Relational databases", "Authentication"],
    gaps: ["Distributed systems at scale", "Event-driven architecture", "Advanced database tuning"],
    feedbackBase: [
      "Strong grasp of API design and data modeling fundamentals.",
      "Experience could deepen in distributed systems and async messaging.",
      "Expected ownership of service reliability and performance SLOs.",
    ],
    bullets: [
      "Designed REST and gRPC APIs serving 10M+ requests per day.",
      "Optimized Postgres queries reducing p95 latency from 800ms to 120ms.",
      "Built event-driven pipeline with Kafka processing 5M events/day.",
      "Led migration from monolith to microservices across 8 domains.",
      "Implemented caching layer with Redis cutting DB load by 60%.",
      "Hardened auth stack with OAuth2 and rate limiting.",
    ],
  },
  "Data Scientist": {
    skills: ["Python", "ML / Modeling", "SQL", "Statistics", "MLOps", "Visualization"],
    covered: ["Exploratory analysis", "Model training", "A/B testing basics"],
    gaps: ["Productionizing models at scale", "Causal inference depth", "Feature store architecture"],
    feedbackBase: [
      "Strong foundation in applied ML and statistical analysis.",
      "Experience lacks depth in MLOps and production model monitoring.",
      "Expected ownership of experimentation frameworks and impact measurement.",
    ],
    bullets: [
      "Built churn prediction model improving retention by 12%.",
      "Designed and analyzed A/B tests driving $2M+ in annual revenue.",
      "Productionized ML pipelines using Airflow and MLflow.",
      "Developed forecasting models with 15% lower MAPE than baseline.",
      "Partnered with product to translate insights into roadmap priorities.",
      "Authored internal guides on experimentation and causal methods.",
    ],
  },
  "Cloud Engineer": {
    skills: ["AWS / Azure / GCP", "Terraform", "Networking", "Security", "Kubernetes", "Linux"],
    covered: ["Cloud resource provisioning", "IAM basics", "Container deployments"],
    gaps: ["Multi-cloud architecture", "Advanced cost optimization", "Zero-trust network design"],
    feedbackBase: [
      "Solid understanding of core cloud services and infrastructure.",
      "Experience could deepen in multi-region high availability design.",
      "Expected ownership of cloud security posture and cost efficiency.",
    ],
    bullets: [
      "Architected and deployed highly available infrastructure across 3 cloud regions.",
      "Implemented security best practices reducing IAM vulnerabilities by 80%.",
      "Automated infrastructure provisioning with Terraform and CI/CD pipelines.",
      "Optimized cloud architecture, reducing monthly spend by 30%.",
      "Designed resilient networking topologies with VPCs, VPNs, and WAFs.",
      "Migrated legacy on-prem applications to cloud-native containerized services.",
    ],
  },
  "AI/ML Engineer": {
    skills: ["AWS / Azure / GCP", "Terraform", "Networking", "Security", "Kubernetes", "Linux"],
    covered: ["Cloud resource provisioning", "IAM basics", "Container deployments"],
    gaps: ["Multi-cloud architecture", "Advanced cost optimization", "Zero-trust network design"],
    feedbackBase: [
      "Solid understanding of core cloud services and infrastructure.",
      "Experience could deepen in multi-region high availability design.",
      "Expected ownership of cloud security posture and cost efficiency.",
    ],
    bullets: [
      "Architected and deployed highly available infrastructure across 3 cloud regions.",
      "Implemented security best practices reducing IAM vulnerabilities by 80%.",
      "Automated infrastructure provisioning with Terraform and CI/CD pipelines.",
      "Optimized cloud architecture, reducing monthly spend by 30%.",
      "Designed resilient networking topologies with VPCs, VPNs, and WAFs.",
      "Migrated legacy on-prem applications to cloud-native containerized services.",
    ],
  },
};

const DEFAULT_PROFILE = ROLE_PROFILES["Backend Engineer"];

export const ROLE_SUGGESTIONS = Object.keys(ROLE_PROFILES);

function levelFor(years: number): { label: string; factor: number } {
  if (years <= 1) return { label: "Entry", factor: 0.35 };
  if (years <= 3) return { label: "Junior", factor: 0.5 };
  if (years <= 5) return { label: "Mid-level", factor: 0.65 };
  if (years <= 8) return { label: "Senior", factor: 0.78 };
  if (years <= 12) return { label: "Staff", factor: 0.88 };
  return { label: "Principal", factor: 0.95 };
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function analyze(role: string, years: number): AnalysisResult {
  const profile =
    ROLE_PROFILES[role] ||
    Object.entries(ROLE_PROFILES).find(([k]) =>
      k.toLowerCase().includes(role.toLowerCase().trim()),
    )?.[1] ||
    DEFAULT_PROFILE;

  const { label, factor } = levelFor(years);

  const skills: Skill[] = profile.skills.map((name, i) => {
    const seed = hash(role + name) % 20;
    const base = Math.round(factor * 100);
    const variance = ((seed % 15) - 7);
    const score = Math.max(15, Math.min(95, base + variance - i * 2));
    const min = Math.max(10, score - 10 - (seed % 5));
    const max = Math.min(100, score + 8 + (seed % 6));
    return { name, score, min, max };
  });

  const feedback = [
    ...profile.feedbackBase,
    years < 3
      ? "Profile reads early-career — emphasize measurable project outcomes."
      : years >= 8
        ? "Profile reads senior — highlight org-level impact and mentorship."
        : "Profile reads mid-level — quantify ownership and cross-team collaboration.",
  ];

  return {
    role: role || "Your role",
    years,
    level: label,
    skills,
    feedback,
    covered: profile.covered,
    gaps: profile.gaps,
    resumePoints: profile.bullets.slice(0, 6),
  };
}
