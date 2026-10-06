// Shared date/time formatting for assigned work, so every screen shows the
// same labelled "Assigned" and "Due" times in Lagos time.
const FORMAT:Intl.DateTimeFormatOptions={
  dateStyle:'medium',
  timeStyle:'short',
  timeZone:'Africa/Lagos'
}

export function formatWorkTime(iso?:string|null):string{
  if(!iso){
    return ''
  }

  const date=new Date(iso)

  if(Number.isNaN(date.getTime())){
    return ''
  }

  return date.toLocaleString('en-NG',FORMAT)
}

export function isWorkOverdue(
  dueAt:string|null|undefined,
  status:string
):boolean{
  if(!dueAt || status==='completed' || status==='cancelled'){
    return false
  }

  const due=new Date(dueAt).getTime()

  return !Number.isNaN(due) && due<Date.now()
}
