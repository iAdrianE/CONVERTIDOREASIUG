import bcryptjs from "bcryptjs"
import jsonwebtoken from "jsonwebtoken";
import dotenv from "dotenv";
//Acepta un unico usuario, puede ser vinculado a base de datos.
export const usuarios =[{
user: "user",
email: "a@a.com",
password: "$2a$05$CQM0.vOxjDK.RKxZCTqg/.MGzFoMZvX2B6YL/KV2bd3vKwEr5Mq/i"
}]


async function login(req,res){
    console.log(req.body);
    const user = req.body.user;
    const password = req.body.password;
    if(!user || !password){
      return res.status(400).send({status:"Error",message:"Los campos están incompletos"})
    }
    const revisionusuarios = usuarios.find(usuario => usuario.user === user);
    if(!revisionusuarios){
      return res.status(400).send({status:"Error",message:"Error durante el inicio de sesión"})
    }
    const loginCorrecto = await bcryptjs.compare(password,revisionusuarios.password);
    if(!loginCorrecto){
      return res.status(400).send({status:"Error",message:"Error durante el inicio de sesión"})
    }
    const token = jsonwebtoken.sign(
      {user:revisionusuarios.user},
      process.env.JWT_SECRET,
      {expiresIn:process.env.JWT_EXPIRATION});
  
      const cookieOption = {
        expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES * 24 * 60 * 60 * 1000),
        path: "/"
      }
      res.cookie("jwt",token,cookieOption);
      res.send({status:"ok",message:"Usuario ingresado",redirect:"/convertidor"});
  } 
  

async function register(req,res){ 
console.log(req.body)
const user= req.body.user;
const password= req.body.password;
const email= req.body.email;
if(!user || !password  || !email){ return res.status(400).send({status:"ERROR",message: "CAMPOS INCOMPLETOS"})    
}
const revisionusuarios = usuarios.find(usuario => usuario.user === user)
if (revisionusuarios)
{
    return res.status(400).send({
        status: "ERROR",
        message: "Usuario ya existe"
    })
}
const salt = await bcryptjs.genSalt(5);
const hashPassword = await  bcryptjs.hash(password,salt);
const nuevoUsuario = {
    user, email, password: hashPassword
}
usuarios.push(nuevoUsuario);
console.log(usuarios);
return res.status(201).send({status:"ok",message:`Usuario ${nuevoUsuario.user} agregado`, redirect:"/"})
}

export const methods ={
login,
register
}