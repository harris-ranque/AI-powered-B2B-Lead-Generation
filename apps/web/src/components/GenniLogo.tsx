export function GenniLogo({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <div className={`${className} flex items-center justify-center`}>
      <img
        src="/genni-logo.webp"
        alt="Genni Logo"
        className="w-full h-full object-contain"
      />
    </div>
  );
}
