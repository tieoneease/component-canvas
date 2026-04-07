const DB_NAME = 'component-canvas-thumbnails'
const STORE_NAME = 'thumbnails'
const TIMESTAMP_INDEX = 'by-timestamp'
const DB_VERSION = 1
const MAX_ENTRIES = 200

const NOOP_CACHE = Object.freeze({
  db: null,
  noop: true
})

let cacheHandle = null
let cachePromise = null

export async function openThumbnailCache() {
  if (cacheHandle) {
    return cacheHandle
  }

  if (cachePromise) {
    return cachePromise
  }

  if (typeof indexedDB === 'undefined') {
    warn('IndexedDB is unavailable; thumbnail cache disabled')
    cacheHandle = NOOP_CACHE
    cachePromise = Promise.resolve(cacheHandle)
    return cachePromise
  }

  cachePromise = new Promise((resolve) => {
    let settled = false

    const finish = (nextHandle) => {
      if (settled) {
        if (nextHandle?.db) {
          nextHandle.db.close()
        }

        return
      }

      settled = true
      cacheHandle = nextHandle
      resolve(cacheHandle)
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction?.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'screenKey' })

        if (store && !store.indexNames.contains(TIMESTAMP_INDEX)) {
          store.createIndex(TIMESTAMP_INDEX, 'timestamp')
        }
      }

      request.onsuccess = () => {
        const db = request.result

        db.onversionchange = () => {
          db.close()
        }

        finish({ db })
      }

      request.onerror = () => {
        warn('Failed to open thumbnail cache', request.error)
        finish(NOOP_CACHE)
      }

      request.onblocked = () => {
        warn('Thumbnail cache open is blocked by another tab or window')
        finish(NOOP_CACHE)
      }
    } catch (error) {
      warn('Failed to open thumbnail cache', error)
      finish(NOOP_CACHE)
    }
  })

  return cachePromise
}

export async function getThumbnail(cache, screenKey) {
  if (!hasDatabase(cache) || !isNonEmptyString(screenKey)) {
    return null
  }

  try {
    const transaction = cache.db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const entry = await requestToPromise(store.get(screenKey))

    if (!entry || typeof entry !== 'object') {
      return null
    }

    return {
      blob: entry.blob ?? null,
      width: normalizeNumber(entry.width),
      height: normalizeNumber(entry.height),
      timestamp: normalizeNumber(entry.timestamp)
    }
  } catch (error) {
    warn(`Failed to read thumbnail for ${screenKey}`, error)
    return null
  }
}

export async function putThumbnail(cache, screenKey, blob, width, height) {
  if (!hasDatabase(cache) || !isNonEmptyString(screenKey) || !isBlob(blob)) {
    return
  }

  try {
    await writeEntry(cache.db, {
      screenKey,
      blob,
      width: normalizeNumber(width),
      height: normalizeNumber(height),
      timestamp: Date.now()
    })

    await evictOldEntries(cache.db)
  } catch (error) {
    warn(`Failed to store thumbnail for ${screenKey}`, error)
  }
}

export async function deleteThumbnail(cache, screenKey) {
  if (!hasDatabase(cache) || !isNonEmptyString(screenKey)) {
    return
  }

  try {
    await runStoreMutation(cache.db, 'readwrite', (store) => store.delete(screenKey))
  } catch (error) {
    warn(`Failed to delete thumbnail for ${screenKey}`, error)
  }
}

export async function deleteThumbnailsByPrefix(cache, prefix) {
  if (!hasDatabase(cache) || typeof prefix !== 'string') {
    return
  }

  if (prefix.length === 0) {
    await clearAllThumbnails(cache)
    return
  }

  try {
    const keyRange = typeof IDBKeyRange !== 'undefined'
      ? IDBKeyRange.bound(prefix, `${prefix}\uffff`)
      : null

    if (keyRange) {
      await runStoreMutation(cache.db, 'readwrite', (store) => store.delete(keyRange))
      return
    }

    await deleteByPrefixWithCursor(cache.db, prefix)
  } catch (error) {
    warn(`Failed to delete thumbnails with prefix ${prefix}`, error)
  }
}

export async function clearAllThumbnails(cache) {
  if (!hasDatabase(cache)) {
    return
  }

  try {
    await runStoreMutation(cache.db, 'readwrite', (store) => store.clear())
  } catch (error) {
    warn('Failed to clear thumbnails', error)
  }
}

export async function listThumbnailKeys(cache) {
  if (!hasDatabase(cache)) {
    return []
  }

  try {
    const transaction = cache.db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    if (typeof store.getAllKeys === 'function') {
      const keys = await requestToPromise(store.getAllKeys())
      return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []
    }

    return await listKeysWithCursor(store)
  } catch (error) {
    warn('Failed to list thumbnail keys', error)
    return []
  }
}

function hasDatabase(cache) {
  return Boolean(cache?.db) && cache !== NOOP_CACHE
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? value : 0
}

function isBlob(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function warn(message, error) {
  if (typeof error === 'undefined') {
    console.warn(`[component-canvas] ${message}`)
    return
  }

  console.warn(`[component-canvas] ${message}:`, error?.message ?? error)
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function writeEntry(db, entry) {
  await runStoreMutation(db, 'readwrite', (store) => store.put(entry))
}

async function runStoreMutation(db, mode, operation) {
  const transaction = db.transaction(STORE_NAME, mode)
  const store = transaction.objectStore(STORE_NAME)
  const request = operation(store)
  const completion = transactionToPromise(transaction)

  if (request) {
    await requestToPromise(request)
  }

  await completion
}

async function evictOldEntries(db) {
  const count = await countEntries(db)

  if (count <= MAX_ENTRIES) {
    return
  }

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index(TIMESTAMP_INDEX)
    let remaining = count - MAX_ENTRIES

    const cursorRequest = index.openCursor()

    cursorRequest.onsuccess = () => {
      if (remaining <= 0) {
        return
      }

      const cursor = cursorRequest.result

      if (!cursor) {
        return
      }

      const deleteRequest = cursor.delete()

      deleteRequest.onerror = () => {
        reject(deleteRequest.error ?? new Error('Failed to delete old thumbnail entry'))
      }

      deleteRequest.onsuccess = () => {
        remaining -= 1

        if (remaining > 0) {
          cursor.continue()
        }
      }
    }

    cursorRequest.onerror = () => {
      reject(cursorRequest.error ?? new Error('Failed to iterate thumbnail entries'))
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function countEntries(db) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  return requestToPromise(store.count())
}

function deleteByPrefixWithCursor(db, prefix) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const cursorRequest = store.openKeyCursor()

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result

      if (!cursor) {
        return
      }

      if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
        const deleteRequest = cursor.delete()

        deleteRequest.onerror = () => {
          reject(deleteRequest.error ?? new Error('Failed to delete thumbnail entry'))
        }

        deleteRequest.onsuccess = () => {
          cursor.continue()
        }

        return
      }

      cursor.continue()
    }

    cursorRequest.onerror = () => {
      reject(cursorRequest.error ?? new Error('Failed to iterate thumbnail keys'))
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function listKeysWithCursor(store) {
  return new Promise((resolve, reject) => {
    const keys = []
    const request = store.openKeyCursor()

    request.onsuccess = () => {
      const cursor = request.result

      if (!cursor) {
        resolve(keys)
        return
      }

      if (typeof cursor.key === 'string') {
        keys.push(cursor.key)
      }

      cursor.continue()
    }

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to iterate thumbnail keys'))
    }
  })
}
