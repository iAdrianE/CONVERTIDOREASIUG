import jsonwebtoken from "jsonwebtoken";
import dotenv from "dotenv";
import {usuarios} from "./../controllers/authentication.controller.js";

dotenv.config();

function soloConvertidor(req,res,next){
//  const logueado = revisarCookie(req);
//  if(logueado) return next();
return next();  // Permitir el acceso sin verificación. Eliminar y descomentar el resto de esta seccion cuando se vaya a implementar un logeo real
//  return res.redirect("/")    
}
  
function soloPublico(req,res,next){
  const logueado = revisarCookie(req);
  if(!logueado) return next();
  return res.redirect("/convertidor")   
}

function revisarCookie(req){
  try{
    const cookieJWT = req.headers.cookie.split("; ").find(cookie => cookie.startsWith("jwt=")).slice(4);
    const decodificada = jsonwebtoken.verify(cookieJWT,process.env.JWT_SECRET);
    console.log(decodificada)
    const revisionusuarios = usuarios.find(usuario => usuario.user === decodificada.user);
    console.log(revisionusuarios)
    if(!revisionusuarios){
      return false
    }
    return true;  
  }
  catch{
    return false;
  }
}


export const methods = {
  soloConvertidor,
  soloPublico,
}