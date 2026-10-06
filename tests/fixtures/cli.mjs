// Synthetic process fixture: no real credentials or network.
const scenario=process.argv[2];process.stdin.resume();
if(scenario==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
else if(scenario==='flood'){process.stdout.write('é'.repeat(100000));setInterval(()=>{},1000);}
else if(scenario==='stderr'){process.stderr.write('synthetic-private-diagnostic');process.exitCode=1;}
else if(scenario==='malformed'){console.log('PRIVATE_PROMPT malformed');}
else{for(const event of [{type:'thread.started'},{type:'turn.started'},
  {type:'item.completed',item:{type:'agent_message',text:'{"risk":"low","decision":"allow"}'}},
  {type:'turn.completed'}])console.log(JSON.stringify(event));}
