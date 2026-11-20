const snapshots = [0, 1, 2]

/** A game's own page: its cover (beside its name on a phone), its name and buttons, then its sections */
export function SkeletonGame() {
  return (
    <div className='flex w-full flex-col gap-4 p-4 md:flex-row md:gap-8 lg:p-6'>
      <div className='flex items-start gap-4 md:block md:w-56 md:shrink-0 lg:w-64'>
        <div className='aspect-4/7 w-[36%] shrink-0 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse md:aspect-3/4 md:w-full' />
        <div className='flex min-w-0 flex-1 flex-col gap-2 md:hidden'>
          <div className='h-6 w-full rounded-lg bg-(--gray-a3)' />
          <div className='h-6 w-2/3 rounded-lg bg-(--gray-a3)' />
          <div className='h-3 w-16 rounded-full bg-(--gray-a3)' />
        </div>
      </div>

      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <div className='hidden h-9 w-80 max-w-full rounded-lg bg-(--gray-a3) motion-safe:animate-pulse md:mt-1 md:block' />
        <div className='hidden h-3 w-16 rounded-full bg-(--gray-a3) md:block' />
        <div className='mt-1 flex gap-3 md:mt-4'>
          <div className='h-12 flex-1 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse md:w-56 md:flex-none' />
          <div className='h-12 flex-1 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse md:w-36 md:flex-none' />
        </div>
        <div className='mt-6 h-5 w-28 rounded-lg bg-(--gray-a3)' />
        <div className='flex gap-3'>
          {snapshots.map((snapshot) => (
            <div className='aspect-4/3 w-32 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse' key={snapshot} />
          ))}
        </div>
        <div className='mt-6 h-5 w-24 rounded-lg bg-(--gray-a3)' />
        <div className='h-3 w-full max-w-xl rounded-full bg-(--gray-a3)' />
        <div className='h-3 w-4/5 max-w-lg rounded-full bg-(--gray-a3)' />
      </div>
    </div>
  )
}
