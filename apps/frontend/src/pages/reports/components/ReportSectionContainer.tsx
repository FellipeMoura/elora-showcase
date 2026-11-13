
export function ReportSectionContainer({ children }: { children: React.ReactNode }): React.ReactElement {


  return (
        <div className="flex flex-col gap-3 ">
            {children}
        </div>
  )
}