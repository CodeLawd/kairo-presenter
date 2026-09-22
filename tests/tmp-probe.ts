import fs from 'fs'; import os from 'os'; import path from 'path'
import { buildSlides } from '../src/lib/lyrics-slides'
const dir = path.join(os.homedir(), 'Documents/Kairo Presenter/Songs')
const songs = fs.readdirSync(dir).filter(f => f.endsWith('.song.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
const counts = songs.map(s => ({ t: s.title, n: buildSlides(s, { glossColor: '#D4A017' }).length })).sort((a,b)=>b.n-a.n)
console.log('max slides:', counts.slice(0,5).map(c=>`${c.t}=${c.n}`).join(', '))
console.log('median:', counts[Math.floor(counts.length/2)].n)
