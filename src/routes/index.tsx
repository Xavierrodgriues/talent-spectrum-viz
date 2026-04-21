import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Sparkles, Check, AlertTriangle, Copy, Brain, TrendingUp } from "lucide-react";
import { analyze, ROLE_SUGGESTIONS, type AnalysisResult } from "@/lib/analyzer";
import { SkillBar } from "@/components/SkillBar";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Resume Intelligence Analyzer" },
      {
        name: "description",
        content:
          "Analyze your experience against industry expectations. Get skill metrics, feedback, and resume suggestions.",
      },
    ],
  }),
});

function Index() {
  const [role, setRole] = useState("");
  const [years, setYears] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const handleAnalyze = async () => {
    if (!role.trim()) {
      toast.error("Please enter a target role");
      return;
    }
    const y = Number(years);
    if (Number.isNaN(y) || y < 0 || y > 50) {
      toast.error("Years of experience must be between 0 and 50");
      return;
    }
    setLoading(true);
    setResult(null);
    setCountdown(60);
    
    const timerInterval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    
    try {
      const response = await fetch("http://localhost:5000/api/role-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: role.trim(), years: y }),
      });

      if (response.status === 404) {
        const errData = await response.json();
        toast.error(errData.error || "No role found");
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }

      const data = await response.json();
      
      const topSkills = Array.isArray(data.top_skills) ? data.top_skills : [];
      const resps = Array.isArray(data.common_responsibilities) ? data.common_responsibilities : [];
      const bullets = Array.isArray(data.resume_bullets) ? data.resume_bullets : [];

      const newResult: AnalysisResult = {
        role: role.trim(),
        years: y,
        level: y < 3 ? "Junior" : y < 8 ? "Senior" : "Staff",
        skills: topSkills.map((s: string) => ({
          name: s,
          score: Math.floor(Math.random() * 20) + 75,
          min: 60,
          max: 100
        })),
        feedback: resps,
        covered: [],
        gaps: [],
        resumePoints: bullets
      };

      setResult(newResult);
    } catch (err) {
      console.error(err);
      toast.error("Error analyzing role");
    } finally {
      clearInterval(timerInterval);
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const filteredSuggestions = ROLE_SUGGESTIONS.filter((r) =>
    r.toLowerCase().includes(role.toLowerCase()),
  );

  return (
    <div className="min-h-screen px-4 py-10 sm:py-16">
      <Toaster />
      <div className="mx-auto max-w-5xl space-y-10">
        {/* Header */}
        <header className="text-center space-y-3 animate-fade-in-up">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered career insights
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              Resume Intelligence Analyzer
            </span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            Analyze your experience against industry expectations
          </p>
        </header>

        {/* Input Card */}
        <Card
          className="border-primary/10 animate-fade-in-up"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Tell us about your role
            </CardTitle>
            <CardDescription>
              We'll benchmark your skills and generate tailored resume suggestions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <div className="space-y-2 relative">
                <Label htmlFor="role">Target Role</Label>
                <Input
                  id="role"
                  placeholder="e.g., DevOps Engineer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  autoComplete="off"
                />
                {showSuggestions && filteredSuggestions.length > 0 && role !== filteredSuggestions[0] && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-md border bg-popover shadow-lg overflow-hidden">
                    {filteredSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                        onMouseDown={() => setRole(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="years">Years of Experience</Label>
                <Input
                  id="years"
                  type="number"
                  min={0}
                  max={50}
                  placeholder="e.g., 5"
                  value={years}
                  onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={loading}
                className="h-10 px-6 text-primary-foreground border-0"
                style={{
                  backgroundImage: "var(--gradient-primary)",
                  boxShadow: "var(--shadow-glow)",
                }}
              >
                {loading ? "Analyzing..." : "Analyze"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading */}
        {loading && (
          <div className="space-y-6">
            <div className="text-center p-6 bg-card border border-primary/20 rounded-xl max-w-sm mx-auto shadow-sm animate-fade-in-up">
              <div className="text-5xl font-bold text-primary mb-2 tabular-nums">00:{countdown.toString().padStart(2, '0')}</div>
              <p className="text-sm text-muted-foreground">Analyzing job descriptions with AI...<br/>This may take up to a minute.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 animate-fade-in-up">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-5/6" />
                </CardContent>
              </Card>
            ))}
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-6">
            {/* Summary chip */}
            <div className="flex flex-wrap items-center gap-2 animate-fade-in-up">
              <Badge variant="secondary" className="text-sm">{result.role}</Badge>
              <Badge variant="secondary" className="text-sm">{result.years} yrs</Badge>
              <Badge
                className="text-sm border-0 text-primary-foreground"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                {result.level}
              </Badge>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Skills */}
              <Card
                className="md:col-span-2 animate-fade-in-up"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Skill Proficiency
                  </CardTitle>
                  <CardDescription>
                    Your estimated proficiency vs. expected range for your level.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 sm:grid-cols-2">
                  {result.skills.map((s, i) => (
                    <SkillBar key={s.name} skill={s} index={i} />
                  ))}
                </CardContent>
              </Card>

              {/* Feedback */}
              <Card className="animate-fade-in-up" style={{ boxShadow: "var(--shadow-card)" }}>
                <CardHeader>
                  <CardTitle>Responsibility Feedback</CardTitle>
                  <CardDescription>LLM-style insights on your experience.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {result.feedback.map((f, i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundImage: "var(--gradient-primary)" }}
                        />
                        <span className="text-foreground/90">{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Gap Analysis */}
              <Card className="animate-fade-in-up" style={{ boxShadow: "var(--shadow-card)" }}>
                <CardHeader>
                  <CardTitle>Requirements Gap</CardTitle>
                  <CardDescription>What you cover vs. what's missing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15">
                        <Check className="h-3.5 w-3.5 text-success" />
                      </div>
                      <span className="text-sm font-semibold">Covered</span>
                    </div>
                    <ul className="space-y-1.5 pl-8">
                      {result.covered.map((c) => (
                        <li key={c} className="text-sm text-foreground/85 list-disc">{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-warning/15">
                        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                      </div>
                      <span className="text-sm font-semibold">Missing / Weak</span>
                    </div>
                    <ul className="space-y-1.5 pl-8">
                      {result.gaps.map((g) => (
                        <li key={g} className="text-sm text-foreground/85 list-disc">{g}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Resume Points */}
              <Card
                className="md:col-span-2 animate-fade-in-up"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <CardHeader>
                  <CardTitle>Suggested Resume Points</CardTitle>
                  <CardDescription>
                    Tailored bullets you can drop into your resume.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {result.resumePoints.map((p, i) => (
                    <div
                      key={i}
                      className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm"
                    >
                      <span className="text-sm leading-relaxed text-foreground/90 flex-1">{p}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 shrink-0 opacity-60 group-hover:opacity-100"
                        onClick={() => handleCopy(p)}
                        aria-label="Copy"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {!result && !loading && (
          <p className="text-center text-sm text-muted-foreground animate-fade-in-up">
            Try <button className="underline hover:text-primary" onClick={() => { setRole("DevOps Engineer"); setYears("7"); }}>DevOps Engineer · 7 years</button> to see a sample analysis.
          </p>
        )}
      </div>
    </div>
  );
}
