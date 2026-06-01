// eslint-config-next v16 ships native ESLint 9 flat config arrays; import directly.
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default [...coreWebVitals, ...nextTypescript]
