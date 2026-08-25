import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'

import {
  isAllowedLyricsUrl,
  structureBilingualHymn,
  scrapeLyricsPage,
} from '../src/main/services/lyrics/web-lyrics'
import { needsWebResolution } from '../src/main/services/lyrics/online'
import type { ProviderResult } from '../src/main/services/lyrics/provider-types'

const HYMN_FIXTURE = `IJA DOPIN OGUN SI TAN
1. Ija dopin oguun si tan
Olugbala jagun molu
Orin ayo la o ma ko
ALLELUIA!
2. Gbogbo ipa n'iku ti lo
Sugbon Kristi f'ogun re
Aye! E ho iho ayo
ALLELUIA!
3. Ojo meta na ti koja
O jinde kuro ninu oku
E f'ogo fun Oluwa wa
ALLELUIA!
THE STRIVE IS O'ER, THE BATTLE DONE
1. The strive is O'er, the battle done
The victory of life is won
The song of triumph has begun
ALLELUIA!
2. The pow'rs of death have done their worst
But Christ their legions hath dispersed
Let shout of holy joy outburst
ALLELUIA!
3. The three sad days have quickly sped
He rises glorious from the dead
All glory to our risen LORD
ALLELUIA!`

test('isAllowedLyricsUrl accepts Yoruba hymn Blogger hosts', () => {
  assert.equal(
    isAllowedLyricsUrl('https://yorubahymns.blogspot.com/2015/04/ija-dopin-ogun-si-tan.html'),
    true,
  )
  assert.equal(isAllowedLyricsUrl('https://example.com/lyrics'), false)
})

test('structureBilingualHymn zips Yoruba verses with English glosses', () => {
  const out = structureBilingualHymn(HYMN_FIXTURE)
  assert.ok(out)
  assert.match(out!, /\[Verse 1\]/)
  assert.match(out!, /Ija dopin oguun si tan/)
  assert.match(out!, /\(The strive is O'er, the battle done\)/)
  assert.match(out!, /\[Verse 2\]/)
  assert.match(out!, /\(The pow'rs of death have done their worst\)/)
  assert.ok(!out!.includes('THE STRIVE IS O\'ER, THE BATTLE DONE'))
})

test('structureBilingualHymn reflows broken English lines from Blogger', () => {
  const broken = `TITLE
1. Line one Yoruba
ALLELUIA!
2. Line two Yoruba
ALLELUIA!
THE BATTLE IS DONE
1. The
strive is O'er, the battle done
The victory
of life is won
ALLELUIA!
2. Second English verse line
ALLELUIA!`
  const out = structureBilingualHymn(broken)
  assert.ok(out)
  assert.match(out!, /\(The strive is O'er, the battle done\)/)
  assert.match(out!, /\(The victory of life is won\)/)
})

test('needsWebResolution still searches when catalogue lyrics look truncated', () => {
  const gathered: ProviderResult[] = [
    {
      id: 'lrclib:1',
      provider: 'lrclib',
      title: "Ija D'opin (The Strife is O'er)",
      artist: 'Tolu Akande',
      url: 'https://lrclib.net/api/get/1',
      lyrics: "Instruments playing\nIja d'opin\nHALLELUJAH\nEND.",
    },
  ]
  assert.equal(needsWebResolution('ija dopin', gathered), true)
})

test('needsWebResolution skips web when strong title has no lyrics yet', () => {
  const gathered: ProviderResult[] = [
    {
      id: 'genius:1',
      provider: 'genius',
      title: 'Amioluwa',
      artist: 'Sunmisola',
      url: 'https://genius.com/x',
    },
  ]
  assert.equal(needsWebResolution('ami oluwa', gathered), false)
})

const htmlPath = '/tmp/yoruba-hymn.html'
if (fs.existsSync(htmlPath)) {
  test('scrapeLyricsPage reads the live Yoruba Hymns Ija Dopin post', async () => {
    // Use the module against the real URL when network is available in CI/dev.
    const page = await scrapeLyricsPage(
      'https://yorubahymns.blogspot.com/2015/04/ija-dopin-ogun-si-tan.html',
    )
    assert.match(page.title, /ija dopin/i)
    assert.match(page.lyrics, /\[Verse 1\]/)
    assert.match(page.lyrics, /Ija dopin/i)
    assert.match(page.lyrics, /\(/)
    assert.ok(page.lyrics.length > 700)
  })
}
