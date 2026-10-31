import { AbsoluteFill } from 'remotion'
import { Operator } from './Operator'

/** Fidelity check: the rebuild in the captured live state, at the capture's layout size. */
export function OperatorTest(): React.ReactElement {
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Operator
        s={{
          t: 3,
          clock: '00:14:26',
          segs: ['Good morning, church. It’s good to be together.', 'If you’ve got your Bibles, keep them close. We’ll be in one place today.', 'I want to start with a question this morning.', 'When was the last time you felt really tired?'],
          line: { text: 'Jesus said, drink the water I give, and you’ll never be thirsty again.', typed: 1, match: { phrase: 'drink the water I give, and you’ll never be thirsty again', ref: 'John 4:14', lit: 1, chip: 1 } },
          level: 0.1,
          staged: 1,
          border: 1,
          live: 1,
        }}
      />
    </AbsoluteFill>
  )
}
