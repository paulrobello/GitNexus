import { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { AlertTriangle, Maximize2, X, RefreshCw } from 'lucide-react';

const cleanupGlobalMermaidErrors = () => {
  if (typeof document === 'undefined') return;
  // Mermaid may inject error blocks into the document on parse/render failure.
  // Remove them so they don't blow up the page height / scrolling.
  const selectors = [
    '.mermaid-error',
    '.mermaidError',
    '.mermaid-error-container',
    '.mermaidTooltip',
  ];
  try {
    document.querySelectorAll(selectors.join(',')).forEach((el) => el.remove());
  } catch {
    // no-op
  }
};

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
  // Security: strict mode
  securityLevel: 'strict',
  // Avoid Mermaid injecting its own error UI into the document body
  // (prevents the whole app becoming scrollable on syntax errors).
  suppressErrorRendering: true as any,
});
// Also override parseError hook (if supported by the installed Mermaid build)
// to ensure errors stay inside our component UI.
try {
  (mermaid as any).parseError = () => {
    // swallow; component handles errors explicitly
  };
} catch {
  // ignore
}

interface MermaidRendererProps {
  code: string;
  onError?: (error: string) => void;
  className?: string;
}

export const MermaidRenderer = ({ code, onError, className }: MermaidRendererProps) => {
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRendering, setIsRendering] = useState(true); // Start as rendering
  const hasReportedError = useRef(false);

  useEffect(() => {
    if (!code.trim()) {
      setIsRendering(false);
      return;
    }

    let cancelled = false;
    
    const renderDiagram = async () => {
      cleanupGlobalMermaidErrors();
      setIsRendering(true);
      setError(null);

      try {
        // Validate syntax first. This avoids Mermaid's global error renderer side-effects.
        // `parse` throws on syntax errors in newer Mermaid versions.
        if ((mermaid as any).parse) {
          await (mermaid as any).parse(code.trim());
        }

        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        
        // Attempt to render
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
          hasReportedError.current = false;
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Mermaid render error:', err);
          const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram';
          setError(errorMessage);
          setSvg(''); // Clear invalid SVG
          
          // Propagate error to parent if callback provided (only once per code)
          if (onError && !hasReportedError.current) {
            hasReportedError.current = true;
            onError(errorMessage);
          }
        }
      } finally {
        cleanupGlobalMermaidErrors();
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    renderDiagram();
    
    return () => {
      cancelled = true;
    };
  }, [code, onError]); // Re-render when code changes

  const retryRender = useCallback(() => {
    hasReportedError.current = false;
    // Trigger re-render by toggling a state
    setError(null);
    setSvg('');
    setIsRendering(true);
    
    const renderDiagram = async () => {
      cleanupGlobalMermaidErrors();
      try {
        if ((mermaid as any).parse) {
          await (mermaid as any).parse(code.trim());
        }
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        console.error('Mermaid render error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram';
        setError(errorMessage);
        setSvg('');
      } finally {
        cleanupGlobalMermaidErrors();
        setIsRendering(false);
      }
    };
    
    renderDiagram();
  }, [code]);

  if (error) {
    return (
      <div className={`my-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg ${className || ''}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-rose-300 text-sm">
            <AlertTriangle className="w-4 h-4" />
            <span className="font-medium">Diagram Syntax Error</span>
          </div>
          <button 
            onClick={retryRender}
            className="p-1 text-rose-300/70 hover:text-rose-200 transition-colors"
            title="Retry render"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <pre className="text-xs text-rose-200/70 font-mono whitespace-pre-wrap break-all bg-rose-950/30 p-2 rounded mb-2">
          {error}
        </pre>
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary select-none">
            Show raw source
          </summary>
          <pre className="mt-2 p-2 bg-surface rounded text-xs text-text-muted overflow-x-auto font-mono">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  if (!svg && isRendering) {
    return (
      <div className={`my-2 p-8 flex flex-col items-center justify-center bg-surface/30 border border-border-subtle rounded-lg animate-pulse ${className || ''}`}>
        <RefreshCw className="w-5 h-5 text-text-muted animate-spin mb-2" />
        <span className="text-xs text-text-muted">Rendering diagram...</span>
      </div>
    );
  }

  if (!svg) return null;

  return (
    <>
      {/* Inline diagram with expand button */}
      <div className={`my-2 relative group bg-gradient-to-b from-surface/50 to-elevated/50 border border-border-subtle rounded-lg overflow-hidden ${className || ''}`}>
        {/* Toolbar - top right */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-md text-text-muted hover:text-text-primary hover:bg-surface transition-colors shadow-sm"
            title="Expand diagram"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
        
        {/* Diagram container */}
        <div 
          className="flex items-center justify-center p-4 overflow-auto max-h-[500px]"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* Fullscreen modal */}
      {isExpanded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-deep/95 backdrop-blur-md p-8 animate-fade-in">
          {/* Close button */}
          <button
            onClick={() => setIsExpanded(false)}
            className="absolute top-4 right-4 p-2 bg-surface border border-border-subtle rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors z-50 shadow-lg"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
          
          {/* Expanded diagram */}
          <div className="w-full h-full bg-gradient-to-b from-surface to-elevated border border-border-subtle rounded-xl overflow-auto flex items-center justify-center p-8 shadow-2xl">
            <div 
              className="transform scale-110"
              dangerouslySetInnerHTML={{ __html: svg }} 
            />
          </div>
        </div>
      )}
    </>
  );
};

