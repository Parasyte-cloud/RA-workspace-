export const PARASYTE_OPEN_EVENT =
  'ridearrivo:parasyte-open'

export type ParasyteOpenDetail={
  url:string
  title?:string
}

export function openInParasyte(
  url:string,
  title?:string
){

  if(
    typeof window==='undefined'
  ){
    return
  }

  window.dispatchEvent(
    new CustomEvent<ParasyteOpenDetail>(
      PARASYTE_OPEN_EVENT,
      {
        detail:{
          url,
          title
        }
      }
    )
  )

}
