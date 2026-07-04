export default function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
        {title && (
          <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
        )}
        {children}
      </div>
    </div>
  )
}
