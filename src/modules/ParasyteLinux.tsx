import {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  Terminal,
} from '@xterm/xterm'

import {
  FitAddon,
} from '@xterm/addon-fit'

import {
  Maximize2,
  Minimize2,
  Plug,
  Power,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'

import {
  supabase,
} from '../lib/supabase'

import '@xterm/xterm/css/xterm.css'
import '../parasyte-linux.css'


type TerminalSize =
  | 'normal'
  | 'expanded'
  | 'maximized'

type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'


const STORAGE_KEY =
  'ridearrivo-parasyte-linux-size'


function readStoredSize():TerminalSize{
  if(typeof window==='undefined'){
    return 'expanded'
  }

  const value =
    window.localStorage.getItem(
      STORAGE_KEY
    )

  return value==='normal' ||
    value==='expanded' ||
    value==='maximized'
      ? value
      : 'expanded'
}


export default function ParasyteLinux(){

  const terminalHostRef =
    useRef<HTMLDivElement|null>(null)

  const terminalRef =
    useRef<Terminal|null>(null)

  const fitRef =
    useRef<FitAddon|null>(null)

  const socketRef =
    useRef<WebSocket|null>(null)

  const [size,setSize] =
    useState<TerminalSize>(
      readStoredSize
    )

  const [status,setStatus] =
    useState<ConnectionState>(
      'disconnected'
    )

  const [message,setMessage] =
    useState('')

  const gateway =
    String(
      import.meta.env
        .VITE_PARASYTE_LINUX_WS ||
      ''
    ).trim()


  const changeSize=(
    next:TerminalSize
  )=>{
    setSize(next)

    window.localStorage.setItem(
      STORAGE_KEY,
      next
    )

    window.setTimeout(
      ()=>{
        fitRef.current?.fit()
      },
      60
    )
  }


  const sendResize=()=>{
    const terminal =
      terminalRef.current

    const socket =
      socketRef.current

    if(
      !terminal ||
      !socket ||
      socket.readyState!==
        WebSocket.OPEN
    ){
      return
    }

    socket.send(
      JSON.stringify({
        type:'resize',
        cols:terminal.cols,
        rows:terminal.rows,
      })
    )
  }


  const disconnect=()=>{
    const socket =
      socketRef.current

    if(socket){
      socket.close(
        1000,
        'User disconnected'
      )
    }

    socketRef.current=null

    setStatus(
      'disconnected'
    )
  }


  const connect=async()=>{

    setMessage('')

    if(!gateway){
      setStatus('error')

      setMessage(
        'ParAsYtE Linux gateway is not configured yet.'
      )

      terminalRef.current?.writeln(
        '\r\n\x1b[38;2;255;153;0mGateway unavailable.\x1b[0m'
      )

      terminalRef.current?.writeln(
        'The terminal UI is ready. The secure Linux gateway still needs to be deployed.'
      )

      return
    }

    const client =
      supabase

    if(!client){
      setStatus('error')

      setMessage(
        'Workspace authentication is unavailable.'
      )

      return
    }

    const {
      data:{
        session,
      },
      error,
    } =
      await client.auth
        .getSession()

    if(
      error ||
      !session?.access_token
    ){
      setStatus('error')

      setMessage(
        'Your workspace session has expired. Sign in again.'
      )

      return
    }

    if(
      socketRef.current &&
      socketRef.current.readyState===
        WebSocket.OPEN
    ){
      return
    }

    setStatus(
      'connecting'
    )

    terminalRef.current?.writeln(
      '\r\n\x1b[38;2;255;153;0mConnecting to ParAsYtE Linux...\x1b[0m'
    )

    try{

      const socket =
        new WebSocket(
          gateway
        )

      socketRef.current =
        socket

      socket.onopen=()=>{

        const terminal =
          terminalRef.current

        socket.send(
          JSON.stringify({
            type:'auth',
            accessToken:
              session.access_token,
            cols:
              terminal?.cols || 120,
            rows:
              terminal?.rows || 34,
          })
        )
      }


      socket.onmessage=event=>{

        const terminal =
          terminalRef.current

        if(
          !terminal ||
          typeof event.data!==
            'string'
        ){
          return
        }

        try{

          const payload =
            JSON.parse(
              event.data
            )

          if(
            payload?.type===
              'ready'
          ){
            setStatus(
              'connected'
            )

            setMessage(
              'Secure Linux session connected.'
            )

            terminal.focus()

            sendResize()

            return
          }

          if(
            payload?.type===
              'output' &&
            typeof payload.data===
              'string'
          ){
            terminal.write(
              payload.data
            )

            return
          }

          if(
            payload?.type===
              'error'
          ){
            const detail =
              String(
                payload.message ||
                'Linux session error.'
              )

            setStatus(
              'error'
            )

            setMessage(
              detail
            )

            terminal.writeln(
              `\r\n\x1b[31m${detail}\x1b[0m`
            )

            return
          }

        }catch{

          /*
           * Support plain terminal
           * output from a gateway too.
           */
          terminal.write(
            event.data
          )
        }
      }


      socket.onerror=()=>{

        setStatus(
          'error'
        )

        setMessage(
          'Unable to reach the ParAsYtE Linux gateway.'
        )
      }


      socket.onclose=event=>{

        socketRef.current=null

        setStatus(
          event.code===1000
            ? 'disconnected'
            : 'error'
        )

        if(event.code!==1000){
          setMessage(
            'ParAsYtE Linux session disconnected.'
          )
        }

        terminalRef.current
          ?.writeln(
            '\r\n\x1b[90mSession disconnected.\x1b[0m'
          )
      }

    }catch(error){

      console.error(
        'ParAsYtE Linux connection',
        error
      )

      setStatus(
        'error'
      )

      setMessage(
        'Unable to start the Linux session.'
      )
    }
  }


  useEffect(()=>{

    const host =
      terminalHostRef.current

    if(!host){
      return
    }

    const terminal =
      new Terminal({
        cursorBlink:true,
        convertEol:false,

        fontFamily:
          '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',

        fontSize:13,

        lineHeight:1.25,

        scrollback:10000,

        allowTransparency:true,

        theme:{
          background:
            '#050d16',

          foreground:
            '#d8e3ee',

          cursor:
            '#ff9900',

          cursorAccent:
            '#050d16',

          selectionBackground:
            'rgba(255,153,0,.25)',

          black:
            '#07111d',

          red:
            '#ff6b6b',

          green:
            '#62d394',

          yellow:
            '#ffb84d',

          blue:
            '#75a7ff',

          magenta:
            '#bd8cff',

          cyan:
            '#72d8de',

          white:
            '#e8eef5',

          brightBlack:
            '#6e8092',

          brightRed:
            '#ff8585',

          brightGreen:
            '#7ce3ab',

          brightYellow:
            '#ffc76c',

          brightBlue:
            '#96bcff',

          brightMagenta:
            '#cfa8ff',

          brightCyan:
            '#92edf2',

          brightWhite:
            '#ffffff',
        },
      })

    const fit =
      new FitAddon()

    terminal.loadAddon(
      fit
    )

    terminal.open(
      host
    )

    terminalRef.current =
      terminal

    fitRef.current =
      fit

    window.setTimeout(
      ()=>{
        fit.fit()
      },
      20
    )

    terminal.writeln(
      '\x1b[1;38;2;255;153;0mParAsYtE Linux\x1b[0m'
    )

    terminal.writeln(
      '\x1b[38;2;129;151;171mRideArrivo Secure Engineering Environment\x1b[0m'
    )

    terminal.writeln('')

    if(gateway){
      terminal.writeln(
        'Select Connect to start your isolated Linux session.'
      )
    }else{
      terminal.writeln(
        'Terminal client ready.'
      )

      terminal.writeln(
        'Secure Linux gateway deployment is required before shell access becomes available.'
      )
    }


    const input =
      terminal.onData(
        data=>{

          const socket =
            socketRef.current

          if(
            !socket ||
            socket.readyState!==
              WebSocket.OPEN ||
            status!==
              'connected'
          ){
            return
          }

          socket.send(
            JSON.stringify({
              type:'input',
              data,
            })
          )
        }
      )


    const resizeObserver =
      new ResizeObserver(
        ()=>{
          try{
            fit.fit()
            sendResize()
          }catch{
            // Ignore transient layout changes.
          }
        }
      )

    resizeObserver.observe(
      host
    )


    return()=>{

      input.dispose()

      resizeObserver.disconnect()

      const socket =
        socketRef.current

      if(socket){
        socket.close(
          1000,
          'Terminal closed'
        )
      }

      socketRef.current=null

      terminal.dispose()

      terminalRef.current=null

      fitRef.current=null
    }

  },[
    gateway,
    status,
  ])


  const clear=()=>{
    terminalRef.current
      ?.clear()

    terminalRef.current
      ?.focus()
  }


  return (
    <section
      className="parasyteLinuxShell"
      data-size={size}
    >

      <header className="parasyteLinuxHeader">

        <div className="parasyteLinuxBrand">

          <div className="parasyteLinuxMark">
            <TerminalSquare
              size={21}
            />
          </div>

          <div>
            <span>
              SECURE ENGINEERING ENVIRONMENT
            </span>

            <h2>
              ParAsYtE Linux
            </h2>
          </div>

        </div>


        <div className="parasyteLinuxHeaderActions">

          <label className="parasyteLinuxSize">

            <span>
              Terminal size
            </span>

            <select
              value={size}
              onChange={event=>
                changeSize(
                  event.target
                    .value as TerminalSize
                )
              }
            >
              <option value="normal">
                Normal
              </option>

              <option value="expanded">
                Expanded
              </option>

              <option value="maximized">
                Maximized
              </option>
            </select>

          </label>


          <button
            type="button"
            className="parasyteLinuxIconButton"
            onClick={()=>
              changeSize(
                size==='maximized'
                  ? 'expanded'
                  : 'maximized'
              )
            }
            title={
              size==='maximized'
                ? 'Restore terminal'
                : 'Maximize terminal'
            }
          >
            {size==='maximized'
              ? <Minimize2 size={17}/>
              : <Maximize2 size={17}/>
            }
          </button>

        </div>

      </header>


      <div className="parasyteLinuxStatusBar">

        <span
          className={
            `parasyteLinuxStatus ${status}`
          }
        >
          <i/>

          {status==='connected'
            ? 'Connected'
            : status==='connecting'
              ? 'Connecting'
              : status==='error'
                ? 'Attention'
                : 'Disconnected'
          }
        </span>


        <span>
          <ShieldCheck size={13}/>
          Isolated engineering session
        </span>


        <span>
          Environment: Development
        </span>

      </div>


      <div
        className="parasyteLinuxTerminal"
        ref={terminalHostRef}
      />


      <footer className="parasyteLinuxFooter">

        <div>

          {message
            ? (
              <span
                className="parasyteLinuxMessage"
                aria-live="polite"
              >
                {message}
              </span>
            )
            : (
              <span>
                No host shell or production credentials are exposed.
              </span>
            )
          }

        </div>


        <div className="parasyteLinuxControls">

          <button
            type="button"
            onClick={clear}
          >
            <RotateCcw size={14}/>
            Clear
          </button>


          {status==='connected' ||
           status==='connecting'
            ? (
              <button
                type="button"
                onClick={disconnect}
              >
                <Power size={14}/>
                Disconnect
              </button>
            )
            : (
              <button
                type="button"
                className="primary"
                onClick={()=>
                  void connect()
                }
              >
                <Plug size={14}/>
                Connect
              </button>
            )
          }

        </div>

      </footer>

    </section>
  )
}
