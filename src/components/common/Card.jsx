export default function Card({ children, className = '', ...props }) {
  return (
    <div className={`rounded-card bg-surface p-4 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  )
}
