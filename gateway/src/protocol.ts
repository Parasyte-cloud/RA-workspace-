export type AuthMessage = {
  type:'auth'
  accessToken:string
  cols:number
  rows:number
}

export type InputMessage = {
  type:'input'
  data:string
}

export type ResizeMessage = {
  type:'resize'
  cols:number
  rows:number
}

export type ClientMessage =
  | AuthMessage
  | InputMessage
  | ResizeMessage

export class ProtocolError extends Error{}

function dimension(
  value:unknown,
  fallback:number,
  maximum:number
):number{
  if(value===undefined){
    return fallback
  }

  if(
    typeof value!=='number' ||
    !Number.isInteger(value) ||
    value<2 ||
    value>maximum
  ){
    throw new ProtocolError('Invalid terminal dimensions')
  }

  return value
}

export function parseClientMessage(
  raw:string
):ClientMessage{
  let value:unknown

  try{
    value=JSON.parse(raw)
  }catch{
    throw new ProtocolError('Message must be valid JSON')
  }

  if(
    !value ||
    typeof value!=='object' ||
    !('type' in value)
  ){
    throw new ProtocolError('Message type is required')
  }

  const message=value as Record<string,unknown>

  if(message.type==='auth'){
    if(
      typeof message.accessToken!=='string' ||
      message.accessToken.length<32 ||
      message.accessToken.length>8192
    ){
      throw new ProtocolError('Invalid access token')
    }

    return {
      type:'auth',
      accessToken:message.accessToken,
      cols:dimension(message.cols,120,400),
      rows:dimension(message.rows,34,200)
    }
  }

  if(message.type==='input'){
    if(
      typeof message.data!=='string' ||
      Buffer.byteLength(message.data,'utf8')>65536
    ){
      throw new ProtocolError('Invalid terminal input')
    }

    return {
      type:'input',
      data:message.data
    }
  }

  if(message.type==='resize'){
    return {
      type:'resize',
      cols:dimension(message.cols,120,400),
      rows:dimension(message.rows,34,200)
    }
  }

  throw new ProtocolError('Unsupported message type')
}
