import { ReactNode } from "react";

interface Props {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

const PageHeader = ({ eyebrow, title, description, action }: Props) => (
  <div className="mb-12 animate-fade-up">
    <p className="eyebrow mb-3">{eyebrow}</p>
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
      <div>
        <h1 className="display text-4xl md:text-5xl mb-3">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground tracking-wide">{description}</p>
        )}
      </div>
      {action}
    </div>
    <div className="hairline mt-8" />
  </div>
);

export default PageHeader;
