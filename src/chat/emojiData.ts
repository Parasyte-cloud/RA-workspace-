// A curated emoji set for the picker. Kept small on purpose: no dependency, no
// large data file, and every entry is a common, widely supported emoji.
export type EmojiGroup = { id: string; label: string; icon: string; items: Array<{ e: string; k: string }> }

const g = (s: string): Array<{ e: string; k: string }> =>
  s.trim().split('\n').map(line => {
    const [e, ...k] = line.trim().split(' ')
    return { e, k: k.join(' ') }
  })

export const EMOJI_GROUPS: EmojiGroup[] = [
  { id: 'smileys', label: 'Smileys', icon: '😀', items: g(`
😀 grin happy
😃 smile happy
😄 laugh happy
😁 beam grin
😆 laughing
😅 sweat relief
🤣 rofl funny lol
😂 joy tears funny lol
🙂 slight smile
🙃 upside down
😉 wink
😊 blush happy
😇 angel innocent
🥰 love hearts
😍 heart eyes love
🤩 star struck wow
😘 kiss
😋 yum tasty
😛 tongue
😜 wink tongue
🤪 zany crazy
🤗 hug
🤭 oops giggle
🤫 shh quiet
🤔 think hmm
🤐 zipper secret
😐 neutral
😑 expressionless
😶 silent
😏 smirk
😒 unamused
🙄 eye roll
😬 grimace
😌 relieved calm
😔 sad pensive
😴 sleep tired
🤒 sick
🤕 hurt
🤢 nausea
🥵 hot
🥶 cold
🥳 party celebrate
😎 cool sunglasses
🤓 nerd
🧐 monocle
😕 confused
😟 worried
🙁 frown
😮 wow surprised
😲 astonished
😳 flushed
🥺 pleading
😢 cry sad
😭 sob cry
😱 scream shock
😖 confounded
😞 disappointed
😓 downcast sweat
😩 weary
😤 triumph steam
😡 angry
🤬 swearing
💀 skull dead
🤡 clown
👻 ghost
🤖 robot
`) },
  { id: 'gestures', label: 'People', icon: '👍', items: g(`
👍 thumbs up yes ok good
👎 thumbs down no bad
👌 ok perfect
🤌 pinch
✌️ peace victory
🤞 fingers crossed luck
🤟 love you
🤘 rock
🤙 call me
👈 left
👉 right
👆 up
👇 down
☝️ point up
✋ stop hand
🤚 raised hand
👋 wave hello bye
🖖 vulcan
👏 clap applause
🙌 praise hooray
👐 open hands
🤝 handshake deal
🙏 pray thanks please
💪 strong muscle
🫶 heart hands
✍️ writing
🤳 selfie
👀 eyes look
🧠 brain
🫡 salute
🤷 shrug
🤦 facepalm
🙋 raise hand
🙇 bow
💃 dance
🕺 dance
🏃 run
🚶 walk
`) },
  { id: 'hearts', label: 'Hearts', icon: '❤️', items: g(`
❤️ red heart love
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
💔 broken heart
❣️ heart exclamation
💕 two hearts
💞 revolving hearts
💓 beating heart
💗 growing heart
💖 sparkling heart
💘 heart arrow
💝 heart gift
💯 hundred perfect
✨ sparkles
⭐ star
🌟 glowing star
💫 dizzy
🔥 fire hot
💥 boom
💢 anger
💬 speech
💭 thought
`) },
  { id: 'work', label: 'Work', icon: '💼', items: g(`
💼 briefcase work
📅 calendar date
🗓️ calendar
📆 calendar
📌 pin
📍 location pin
📎 paperclip
🖇️ clips
📝 memo note
📋 clipboard
📊 chart bar
📈 chart up growth
📉 chart down
🗂️ folders
📁 folder
📂 open folder
🗃️ file box
📄 document page
📃 page
📑 pages
🧾 receipt invoice
💰 money bag
💵 cash dollar
💳 card payment
🏦 bank
📧 email
📨 incoming mail
📞 phone
☎️ telephone
💻 laptop computer
🖥️ desktop
⌨️ keyboard
🖱️ mouse
🖨️ printer
📱 mobile phone
🔒 lock secure
🔓 unlock
🔑 key
🛠️ tools fix
⚙️ gear settings
🔧 wrench
🔍 search magnify
💡 idea light bulb
📢 announcement loudspeaker
🔔 bell notification
⏰ alarm clock
⏳ hourglass waiting
✅ check done complete
☑️ checked
❌ cross no wrong
⚠️ warning caution
🚫 prohibited
❓ question
❗ exclamation important
🆗 ok
🆕 new
🎯 target goal
🏆 trophy win
🥇 gold first
🎉 party tada celebrate
🎊 confetti
🎁 gift
`) },
  { id: 'travel', label: 'Travel', icon: '✈️', items: g(`
✈️ plane flight airport
🛫 takeoff departure
🛬 landing arrival
🚗 car ride
🚕 taxi
🚙 suv
🚌 bus
🚐 minibus van
🚚 truck delivery
🚛 lorry
🏍️ motorbike
🚲 bicycle
🛵 scooter
🚢 ship boat
⛵ sailboat
🚤 speedboat
🚆 train
🧳 luggage
🗺️ map
🧭 compass
⛽ fuel
🚦 traffic light
🛑 stop sign
🅿️ parking
🏨 hotel
🏠 home house
🏢 office building
🏥 hospital
🏫 school
🌍 africa europe world
🌎 americas world
🌏 asia world
🌅 sunrise
🌇 sunset
🌙 moon night
☀️ sun
🌤️ partly sunny
⛅ cloud
🌧️ rain
⛈️ storm
🌈 rainbow
❄️ snow
`) },
  { id: 'food', label: 'Food', icon: '🍔', items: g(`
☕ coffee tea
🍵 tea
🥤 drink
🍺 beer
🍷 wine
🥂 cheers
🍕 pizza
🍔 burger
🍟 fries
🌭 hot dog
🍗 chicken
🍖 meat
🍚 rice
🍛 curry
🍜 noodles
🍝 pasta
🍲 stew soup
🥗 salad
🥘 pot
🍞 bread
🥐 croissant
🧀 cheese
🍳 egg
🥞 pancakes
🍰 cake
🎂 birthday cake
🍩 doughnut
🍪 cookie
🍫 chocolate
🍬 candy
🍎 apple
🍌 banana
🍊 orange
🍉 watermelon
🍇 grapes
🍓 strawberry
🍍 pineapple
🥭 mango
🥑 avocado
🌶️ pepper chilli
🥜 peanuts
`) },
  { id: 'fun', label: 'Fun', icon: '⚽', items: g(`
⚽ football soccer
🏀 basketball
🏈 american football
🎾 tennis
🏏 cricket
🏐 volleyball
🎮 game controller
🎲 dice
🧩 puzzle
🎵 music note
🎶 notes music
🎤 microphone
🎧 headphones
🎬 movie clapper
📷 camera
📸 camera flash
🎨 art palette
📚 books
📖 book
🎓 graduation
🧪 test tube
🔬 microscope
🚀 rocket launch
🛸 ufo
🐶 dog
🐱 cat
🐭 mouse
🐻 bear
🦁 lion
🐯 tiger
🐵 monkey
🐔 chicken
🐧 penguin
🦅 eagle
🦋 butterfly
🐝 bee
🌳 tree
🌴 palm
🌸 blossom
🌻 sunflower
🌹 rose
🍀 clover luck
`) },
]

export const ALL_EMOJI = EMOJI_GROUPS.flatMap(group => group.items)

export function searchEmoji(query: string): Array<{ e: string; k: string }> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return ALL_EMOJI.filter(item => item.k.toLowerCase().includes(q)).slice(0, 80)
}
