import { BlobReader, BlobWriter, HttpRangeReader, ZipReader } from '@zip.js/zip.js'
import { useEffect, useState } from 'react'

const imageExtensions = ['.gif', '.jpg', '.jpeg', '.png', '.webp']

interface CbzViewerProps {
  src: string
}

/**
 * A comic or manual, its pages one under another. The file is read a part at a time and each page shown as soon as
 * it's unpacked, so the first appears without waiting for the whole file; closing it stops the rest
 */
export function CbzViewer({ src }: Readonly<CbzViewerProps>) {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    // Every page unpacked so far, shown or not, to let go of when the comic is closed
    const urls: string[] = []

    async function getEntries() {
      // A server that can't send parts of a file sends it whole
      try {
        return await new ZipReader(new HttpRangeReader(src)).getEntries()
      } catch {
        const response = await fetch(src, { signal })
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`)
        }
        return await new ZipReader(new BlobReader(await response.blob())).getEntries()
      }
    }

    async function load() {
      try {
        const entries = await getEntries()
        const imageEntries = entries
          .filter((entry) => !entry.directory)
          .filter((entry) => {
            const name = entry.filename.toLowerCase()
            return imageExtensions.some((ext) => name.endsWith(ext))
          })
          .toSorted((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }))

        for (const entry of imageEntries) {
          if (signal.aborted) {
            return
          }
          const data = await entry.getData?.(new BlobWriter(), { signal })
          if (data) {
            urls.push(URL.createObjectURL(data))
            if (!signal.aborted) {
              setPages([...urls])
              setLoading(false)
            }
          }
        }
      } catch {
        // With some pages showing, the comic stays as far as it got
        if (!signal.aborted && urls.length === 0) {
          setError(true)
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false)
        }
      }
    }

    ;(async () => {
      await load()
    })()

    return () => {
      controller.abort()
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [src])

  if (loading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <span className='icon-[svg-spinners--180-ring] size-8 animate-spin text-neutral-400' />
      </div>
    )
  }

  if (error || pages.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <span className='text-neutral-400'>Unable to load comic</span>
      </div>
    )
  }

  return (
    <div className='h-full w-full overflow-y-auto'>
      {pages.map((url, index) => (
        <img
          alt={`Page ${index + 1}`}
          className='w-full'
          key={url}
          loading={index > 2 ? 'lazy' : undefined}
          src={url}
        />
      ))}
    </div>
  )
}
