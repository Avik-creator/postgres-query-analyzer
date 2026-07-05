import type { SVGProps } from "react"

/**
 * pgxray brand mark — a stylized query execution-plan tree
 * (one parent node branching into two child nodes). Uses currentColor
 * so it inherits the surrounding text color.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path
        d="M12 6.6V11M12 11L6.5 17M12 11L17.5 17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="5" r="2.1" fill="currentColor" />
      <circle cx="6" cy="18.5" r="2.1" fill="currentColor" />
      <circle cx="18" cy="18.5" r="2.1" fill="currentColor" />
    </svg>
  )
}
