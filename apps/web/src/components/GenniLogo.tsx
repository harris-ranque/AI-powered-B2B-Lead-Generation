export function GenniLogo({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <div className={`${className} flex items-center justify-center`}>
      <svg
        viewBox="0 0 200 200"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="genni-neon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00FFA3" />
            <stop offset="50%" stopColor="#00E0FF" />
            <stop offset="100%" stopColor="#FFD600" />
          </linearGradient>
          <filter id="neon-pulse-glow">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge> 
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
            <animate attributeName="stdDeviation" values="1;15;1" dur="2.5s" repeatCount="indefinite"/>
          </filter>
        </defs>
        
        <text
          x="100"
          y="120"
          textAnchor="middle"
          fontSize="48"
          fontWeight="800"
          fill="url(#genni-neon-gradient)"
          fontFamily="Orbitron, system-ui, sans-serif"
          filter="url(#neon-pulse-glow)"
        >
          Genni
        </text>
      </svg>
    </div>
  );
}