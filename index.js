const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express()
require('dotenv').config()
const jwt = require('jsonwebtoken')
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);

//middleware
app.use(cors())
app.use(express.json())

const veryfyjwt = (req, res, next)=>{
    const authtoken = req.headers.authtoken?.split(' ')[1];
    if(!authtoken){
        return res.status(401).send({message:'Unautorized access'})
    }

    jwt.verify(authtoken, process.env.ACCESS_TOKEN,(err, decoded)=>{
        if(err){
            return res.status(403).send({message:'Forbidden'})
        }
        req.decoded = decoded
        next()
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.v48zzim.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run(){
    try{
        const appointmentCollection = client.db('appointmentListCollection').collection('appointmentList');
        const newAppointmentCollection = client.db('appointmentListCollection').collection('newAppointment');
        const totalUserCollection = client.db('appointmentListCollection').collection('totalUser');
        const totalDoctorCollection = client.db('appointmentListCollection').collection('totalDoctor');
        const paymentInfoCollection = client.db('appointmentListCollection').collection('paymentInfo');

        //payment
        app.post('/create-payment-intent',async (req, res)=>{
            const appointmentPrice = req.body;
            const amount = appointmentPrice.appointmentPrice * 100;
            const paymentIntent = await stripe.paymentIntents.create({
              amount: amount ,
              currency: "usd",
              payment_method_types: ["card"],
            });

            res.send({
              clientSecret: paymentIntent.client_secret,
            });
        })
        app.post('/storedpaymentInfo',async (req, res)=>{
            const paymentInfo = req.body;
            const result = await paymentInfoCollection.insertOne(paymentInfo)

            const id = paymentInfo.appointmentID;
            const filter = {_id:ObjectId(id)}
            const option = {upsert:true}
            const updatedDoc = {
              $set: {
                paid: true,
                transactionID: paymentInfo.transactionID,
              },
            };
            const updateResult = await newAppointmentCollection.updateOne(filter, updatedDoc, option)
            res.send(result)
        })


        //jwt
        app.get('/jwt',async(req, res)=>{
            const email = req.query.email;
            const query = {email:email}
            const result = await totalUserCollection.findOne(query);
            if(email === result?.email){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN, { expiresIn: "1h" })
                res.send({token})
            }else{
                res.send({access:'Denay'})
            }
        })

        app.get('/appointmentlist',async (req, res)=>{
            const date = req.query.date;
            const query = {};
            const cursor = await appointmentCollection.find(query).toArray();

            const bookedquery = {appointmenDate: date}
            const alreadybooked = await newAppointmentCollection.find(bookedquery).toArray();

            cursor.forEach(option =>{
                const optionBooked = alreadybooked.filter(book => book.appointmentName == option.name)
                const bokedtime = optionBooked.map(book => book.appointmentTime)

                const remining = option.slots.filter(slot => !bokedtime.includes(slot))
                option.slots = remining;
            })

            res.send(cursor)
        })

        //addItem if need
        // app.get('/appointmentlistadd',async(req, res)=>{
        //     const query = {}
        //     const options = {upsert:true}
        //     const updateDoc = {
        //         $set:{
        //             price:99
        //         }
        //     }
        //     const result = await appointmentCollection.updateMany(query, updateDoc, options)
        //     console.log(result)
        // })

        app.post('/appointmentlist',async(req, res)=>{
            const newAppo = req.body;
            const query = {
                appointmenDate:newAppo.appointmenDate,
                appointmentName:newAppo.appointmentName,
                patientEmail:newAppo.patientEmail
            }
            const booked = await newAppointmentCollection.find(query).toArray()
            const message = 'You are not eligible to add'
            if(booked.length){
                return res.send({acknowledged:false, message})
            }
            const result = await newAppointmentCollection.insertOne(newAppo)
            res.send(result)
        })

        app.get('/myappointmentlist', veryfyjwt, async (req, res)=>{
            const email = req.query.email;
            if(email === req.decoded?.email){
                const query = {
                    patientEmail:email
                }
                const result = await newAppointmentCollection.find(query).toArray()
                res.send(result)
            }
        })

        //collect user
        app.post('/totalUser',async(req, res)=>{
            const user = req.body;
            const result = await totalUserCollection.insertOne(user)
            res.send(result)
        })
        app.get('/totalUser',async(req, res)=>{
            const query = {}
            const result = await totalUserCollection.find(query).toArray()
            res.send(result)
        })
        app.put('/totalUser',async(req, res)=>{
            const id = req.query.id;
            const query = {_id:ObjectId(id)}
            const option = {upsert:true}
            const updatedDoc = {
                $set:{
                    role:'admin'
                }
            }
            const result = await totalUserCollection.updateOne(query, updatedDoc, option)
            res.send(result)
        })
        app.put('/adminRemove',async(req, res)=>{
            const id = req.query.id;
            const query = {_id:ObjectId(id)}
            const option = {upsert:false}
            const updatedDoc = {
                $unset:{
                    role:'admin'
                }
            }
            const result = await totalUserCollection.updateOne(query, updatedDoc, option)
            res.send(result)
        })

        app.get('/user/adming/:email', veryfyjwt, async(req, res)=>{
            const email = req.params.email;
            const query = {email}
            const result = await totalUserCollection.findOne(query)
            if(result?.role){
                return res.send({isAdmin:true})
            }else{
                return res.send({isAdmin:false})
            }
        })

        app.get('/specialty',async(req, res)=>{
            const query = {}
            const result = await appointmentCollection.find(query).project({name:1}).toArray()
            res.send(result)
        })
        app.post('/adddoctor',async(req, res)=>{
            const doctor = req.body;
            const result = await totalDoctorCollection.insertOne(doctor)
            res.send(result)
        })
        app.get('/adddoctor', veryfyjwt, async(req, res)=>{
            const query = {}
            const result = await totalDoctorCollection.find(query).toArray()
            res.send(result)
        })
        app.delete('/deletedoctor/:deleteid',async(req, res)=>{
            const deletedid = req.params.deleteid;
            const query = {_id:ObjectId(deletedid)}
            const result = await totalDoctorCollection.deleteOne(query)
            res.send(result)
        })
        
        app.get('/dashboard/payment',async(req, res)=>{
            const id = req.query.id;
            const query = {_id:ObjectId(id)}
            const result = await newAppointmentCollection.findOne(query)
            res.send(result)
        })
    }finally{

    }
}

run().catch(err => console.log(err.message))



app.get('/',(req, res)=>{
    res.send('Your server is Running...')
})
app.listen(port, () => console.log(`Listening on Port ${port}`));