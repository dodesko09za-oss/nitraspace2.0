export async function publishBatch(files,publish,onProgress){
 const queue=Array.from(files)
 let done=0
 for(const file of queue){
   onProgress(done,queue.length,file.name)
   await publish(file)
   done++
   onProgress(done,queue.length,'')
 }
 return done
}
export async function cropPhoto(file){
 const image=await createImageBitmap(file)
 try{
 const width=Math.min(image.width,image.height*.8),height=width/.8
 const canvas=document.createElement('canvas')
 canvas.width=1080;canvas.height=1350
 const ctx=canvas.getContext('2d')
 ctx.fillStyle='#111';ctx.fillRect(0,0,1080,1350)
 ctx.drawImage(image,(image.width-width)/2,(image.height-height)/2,width,height,0,0,1080,1350)
 return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Fotku sa nepodarilo spracovať.')),'image/jpeg',.9))
 }finally{image.close()}
}
