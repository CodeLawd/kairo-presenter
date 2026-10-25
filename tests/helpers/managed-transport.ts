import axios from 'axios'
import type { ManagedRequest } from '../../src/lib/cloud/licensing'
import { managedTransport } from '../../src/main/services/cloud/managed'

// Existing provider algorithm fixtures describe upstream JSON. Adapt their
// mocked HTTP responses at the managed boundary; never use a real credential,
// cloud account, or paid provider in these tests.
const originalPost = axios.post
const originalGet = axios.get
const origins = {
  bible: 'https://api.scripture.api.bible',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  brave: 'https://api.search.brave.com',
  googleTranslate: 'https://translation.googleapis.com',
}
managedTransport.request = async <T>(request: ManagedRequest): Promise<T> => {
  if (request.method === 'POST') {
    if (axios.post === originalPost) throw new Error('Activate managed services before requesting a provider')
    return (await axios.post(origins[request.provider] + request.path, request.body, { headers: {} })).data as T
  }
  if (axios.get === originalGet) throw new Error('Activate managed services before requesting a provider')
  return (await axios.get(origins[request.provider] + request.path, { params: request.query, headers: {} })).data as T
}
