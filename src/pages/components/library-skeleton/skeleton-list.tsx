const covers = Array.from({ length: 24 }, (_, index) => index)

/** A list of games, as most library pages are: the page's title, then a grid of covers */
export function SkeletonList() {
  return (
    <div className='flex flex-col gap-6 p-4 pt-8 lg:px-8'>
      <div className='h-9 w-40 rounded-lg bg-(--gray-a3) motion-safe:animate-pulse' />
      <div className='grid grid-cols-[repeat(auto-fill,minmax(min(140px,100%),1fr))] gap-x-4 gap-y-6 lg:grid-cols-[repeat(auto-fill,minmax(min(192px,100%),1fr))] lg:gap-x-3'>
        {covers.map((cover) => (
          <div className='flex flex-col gap-2 lg:p-1' key={cover}>
            <div className='aspect-square w-full rounded-lg bg-(--gray-a3) motion-safe:animate-pulse' />
            <div className='h-3 w-3/4 rounded-full bg-(--gray-a3) motion-safe:animate-pulse lg:mx-1' />
          </div>
        ))}
      </div>
    </div>
  )
}
