const shimmerClass = 'bg-gradient-to-r from-surface-4 via-surface-5 to-surface-4 bg-[length:200%_100%] animate-shimmer rounded-sm'

export function PlaylistSkeleton() {
  return (
    <div className="mt-8 animate-pulse">
      <div className="mb-6">
        <div className={`h-8 w-3/5 mb-2 ${shimmerClass}`} />
        <div className={`h-5 w-4/5 ${shimmerClass}`} />
      </div>

      <div>
        {Array.from({length: 10}).map((_, index) => (
          <div className="flex items-center gap-4 p-3 mb-2" key={index}>
            <div className={`size-8 ${shimmerClass}`} />
            <div className="flex-1">
              <div className={`h-4 w-[70%] mb-1 ${shimmerClass}`} />
              <div className={`h-3.5 w-[40%] ${shimmerClass}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
