import type { Skill } from "@/lib/analyzer";

export function SkillBar({ skill, index }: { skill: Skill; index: number }) {
  return (
    <div
      className="space-y-2 animate-fade-in-up"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{skill.name}</span>
        <span className="text-sm font-semibold text-primary">{skill.score}%</span>
      </div>
      <div className="relative h-2.5 w-full rounded-full bg-secondary overflow-hidden">
        {/* Expected range band */}
        <div
          className="absolute top-0 h-full rounded-full bg-primary/10 border-x border-primary/20"
          style={{ left: `${skill.min}%`, width: `${skill.max - skill.min}%` }}
          aria-hidden
        />
        {/* Score fill */}
        <div
          className="relative h-full rounded-full animate-bar"
          style={{
            width: `${skill.score}%`,
            background: "var(--gradient-primary)",
            animationDelay: `${index * 80}ms`,
          }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Expected range: {skill.min}%–{skill.max}%</span>
      </div>
    </div>
  );
}
