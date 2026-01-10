import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { AlertTriangle, Maximize2, X } from 'lucide-react';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#06b6d4',
    primaryTextColor: '#e4e4ed',
    primaryBorderColor: '#1e1e2a',
    lineColor: '#3b3b54',
    secondaryColor: '#1e1e2a',
    tertiaryColor: '#0a0a10',
    background: '#0a0a10',
    mainBkg: '#0f0f18',
    nodeBorder: '#3b3b54',
    clusterBkg: '#1e1e2a',
    titleColor: '#e4e4ed',
    edgeLabelBackground: '#0f0f18',
    nodeTextColor: '#e4e4ed',
  },
  flowchart: {
    curve: 'basis',
    padding: 15,
    nodeSpacing: 50,
    rankSpacing: 50,
  },
  sequence: {
    actorMargin: 50,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 35,
  },
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 13,
});

interface MermaidDiagramProps {
  code: string;
}

export const MermaidDiagram = ({ code }: MermaidDiagramProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    const renderDiagram = async () => {
      if (!containerRef.current) return;

      try {
        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
        setSvg('');
      }
    };

    renderDiagram();
  }, [code]);

  if (error) {
    return (
      <div className="my-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg">
        <div className="flex items-center gap-2 text-rose-300 text-sm mb-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium">Diagram Error</span>
        </div>
        <pre className="text-xs text-rose-200/70 font-mono whitespace-pre-wrap">{error}</pre>
        <details className="mt-2">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            Show source
          </summary>
          <pre className="mt-2 p-2 bg-surface rounded text-xs text-text-muted overflow-x-auto">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <>
      {/* Inline diagram with expand button */}
      <div className="my-2 relative group bg-gradient-to-b from-surface/50 to-elevated/50 border border-border-subtle rounded-lg overflow-hidden">
        {/* Expand button - top right */}
        <button
          onClick={() => setIsExpanded(true)}
          className="absolute top-2 right-2 z-10 p-1.5 bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-md text-text-muted hover:text-text-primary hover:bg-surface transition-colors opacity-0 group-hover:opacity-100"
          title="Expand diagram"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        
        {/* Diagram container */}
        <div 
          ref={containerRef}
          className="flex items-center justify-center p-4 overflow-auto max-h-[400px]"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* Fullscreen modal */}
      {isExpanded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-deep/95 backdrop-blur-md p-8">
          {/* Close button */}
          <button
            onClick={() => setIsExpanded(false)}
            className="absolute top-4 right-4 p-2 bg-surface border border-border-subtle rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
          
          {/* Expanded diagram */}
          <div className="w-full h-full bg-gradient-to-b from-surface to-elevated border border-border-subtle rounded-xl overflow-auto flex items-center justify-center p-8">
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      )}
    </>
  );
};

