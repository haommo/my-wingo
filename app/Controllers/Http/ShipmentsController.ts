// App/Controllers/Http/ShipmentController.ts
import { HttpContextContract } from '@ioc:Adonis/Core/HttpContext';
import Shipment from "App/Models/Shipment";
import ShipmentProductInfo from "App/Models/ShipmentProductInfo";
import ShipmentPackageInfo from "App/Models/ShipmentPackageInfo";
import ShipmentHistory from "App/Models/ShipmentHistory";
import ManifestShipment from 'App/Models/ManifestShipment';
import ManifestHistory from 'App/Models/ManifestHistory';
import { schema, rules } from "@ioc:Adonis/Core/Validator";
const { v1: uuidv1 } = require("uuid");
import { createObjectCsvStringifier as createCsvStringifier } from 'csv-writer';
import { DateTime } from 'luxon'; // Import Luxon for date-time handling



import Database from "@ioc:Adonis/Lucid/Database";

export default class ShipmentsController {

 public async index({ auth, response, request }: HttpContextContract) {
  try {
    // Lấy thông tin phân trang và bộ lọc từ request
    const page = request.input('page', 1);
    const perPage = request.input('per_page', 5);
    const filterBy = request.input('filter-by');

    // Khởi tạo truy vấn với các cột cần thiết
    let query = Shipment.query()
      .select(
        'hawb',
        'service_id',
        'local_tracking',
        'status',
        'created_at',
        'sender_address',
        'receiver_address'
      )
      .orderBy('created_at', 'desc');

    // Áp dụng bộ lọc nếu có
    if (filterBy) {
      query = query.where((subQuery) => {
        subQuery
          .whereJson('sender_address', { name: filterBy })
          .orWhereJson('receiver_address', { name: filterBy })
          .orWhere('hawb', filterBy)
          .orWhere('local_tracking', filterBy);
      });
    }

    // Xử lý phân quyền
    const userRole = auth.user.role;
    if (!['RL1', 'RL2'].includes(userRole)) {
      query = query.where('created_for', auth.user.uuid);
    } else {
      const userUuid = request.input('userUuid');
      if (userUuid) {
        query = query.where('created_for', userUuid);
      }
    }

    // Thực hiện truy vấn và phân trang
    const shipments = await query.paginate(page, perPage);

    // Trả về dữ liệu đã phân trang
    return response.ok(shipments);
  } catch (error) {
    // Log lỗi và trả về thông báo lỗi cho người dùng
    console.error('Error fetching shipments: ', error);
    return response.status(500).send({ message: 'Failed to fetch shipments' });
  }
}

public async store({ auth, request, response }: HttpContextContract) {
  const uniqueIdInt = Math.floor(10000000000 + Math.random() * 90000000000).toString();

  const shipmentSchema = schema.create({
    shipment_method: schema.string({ trim: true }, [rules.maxLength(255)]),
    shipment_type: schema.string({ trim: true }, [rules.maxLength(255)]),
    reason_export: schema.string({ trim: true }, [rules.maxLength(255)]),
  });

  const payload = await request.validate({ schema: shipmentSchema });

  payload.hawb = uniqueIdInt; // Sử dụng uniqueIdInt cho hawb và chuyển thành chuỗi
  payload.created_by = auth.user.uuid;
  payload.service_id = request.input('service_id');
  payload.status = request.input('status');
  payload.shipment_content = request.input('shipment_content');
  payload.sender_address = request.input('sender_address');
  payload.receiver_address = request.input('receiver_address');
  
  // Xử lý quyền
  payload.created_for = 
    (['RL1', 'RL2'].includes(auth.user.role)) 
    ? request.input('created_for') 
    : auth.user.uuid;

  // Sử dụng transaction để đảm bảo tính toàn vẹn dữ liệu
  const trx = await Database.transaction();
  
  try {
    const shipment = await Shipment.create(payload, { client: trx });

    const productData = JSON.parse(request.input('product_data'));
    for (const item of productData) {
      await ShipmentProductInfo.create({
        uuid: uuidv1(),
        hawb: shipment.hawb,
        name: item.name,
        description: item.description,
        type: item.type,
        quantity: item.quantity,
        price: item.price,
        amount: item.amount,
      }, { client: trx });
    }

    const packageData = JSON.parse(request.input('package_data'));
    for (const item of packageData) {
      await ShipmentPackageInfo.create({
        uuid: uuidv1(),
        hawb: shipment.hawb,
        quantity: item.quantity,
        type: item.type,
        length: item.length,
        width: item.width,
        height: item.height,
        weight: item.weight,
        subweight: item.subweight,
        subvolume: item.subvolume,
        subcharge: item.subcharge,
      }, { client: trx });
    }

    const senderAddress = JSON.parse(shipment.sender_address);
    const city = senderAddress.city;
    const country = senderAddress.country;
    const date = new Date();

    const shipmentHistory = await ShipmentHistory.create({
      uuid: uuidv1(),
      hawb: shipment.hawb,
      date: date,
      status: 'pending',
      detail: 'Shipment Info Received',
      location: `${city} ${country}`,
    }, { client: trx });

    // Commit transaction nếu tất cả các thao tác thành công
    await trx.commit();

    return response.ok({
      shipment: shipment,
      shipmentHistory: shipmentHistory,
    });
  } catch (error) {
    // Rollback transaction nếu có lỗi
    await trx.rollback();
    console.error('Error creating shipment: ', error);
    return response.status(500).send({ message: 'Failed to create shipment' });
  }
}

public async show({ params, response }: HttpContextContract) {
  try {
    // Sử dụng Eager Loading để load các liên kết liên quan
    const shipment = await Shipment.query()
      .where('hawb', params.id)
      .preload('packageInfos')
      .preload('productInfos')
      .preload('histories')
      .preload('user', (userQuery) => {
          userQuery.select('image');  // Chỉ preload trường image từ bảng users
        })
      .first();

    // Kiểm tra nếu shipment không tồn tại
    if (!shipment) {
      return response.notFound({ message: 'Shipment not found' });
    }

    // Tách riêng các phần dữ liệu liên quan
    const shipment_package_info = shipment.packageInfos;
    const shipment_product_info = shipment.productInfos;
    const shipment_history = shipment.histories;

    // Thêm user_image trực tiếp vào đối tượng shipment
      const user_image = shipment.user?.image || null;  
    // Trả về các phần dữ liệu riêng biệt và toàn bộ các trường trong shipment
    return response.ok({
      shipment: {
          ...shipment.serialize(), // Serialize shipment để loại bỏ các quan hệ không cần thiết
          user_image,  // Bao gồm thêm trường user_image
        },
      shipment_package_info,
      shipment_product_info,
      shipment_history
    });
  } catch (error) {
    console.error('Error fetching shipment details: ', error);
    return response.status(500).send({ message: 'Failed to fetch shipment details' });
  }
}

  // Update shipment
  public async update({ auth, request, params, response }) {
    const shipmentSchema = schema.create({
      shipment_method: schema.string({ trim: true }, [rules.maxLength(255)]),
      shipment_type: schema.string({ trim: true }, [rules.maxLength(255)]),
      reason_export: schema.string({ trim: true }, [rules.maxLength(255)]),
    });

    const payload: any = await request.validate({ schema: shipmentSchema });

    if(auth.user.role == "RL1" && request.input("created_for") == null){
      return response.notFound({
        message:
          "created_for required",
      });
    } else if(auth.user.role == "RL2" && request.input("created_for") == null){
      return response.notFound({
        message:
          "created_for required",
      });
    }


    payload.service_id = request.input("service_id");
    payload.sender_address = request.input("sender_address");
    payload.receiver_address = request.input("receiver_address");
    payload.shipment_content = request.input("shipment_content");
    payload.local_code = request.input("local_code");
    payload.local_tracking = request.input("local_tracking");
    payload.created_for = request.input("created_for");
    payload.created_by = auth.user.uuid;

    const shipment: any = await Shipment.findBy("hawb", params.id);

    if (!shipment) {
      return response.notFound({ message: "Shipment not found" });
    }
    shipment.shipment_method = payload.shipment_method;
    shipment.shipment_type = payload.shipment_type;
    shipment.reason_export = payload.reason_export;
    shipment.service_id = payload.service_id;
    shipment.sender_address = payload.sender_address;
    shipment.receiver_address = payload.receiver_address;
    shipment.created_by = payload.created_by;
    shipment.shipment_content = payload.shipment_content;
    shipment.local_tracking = payload.local_tracking;
    shipment.local_code = payload.local_code;
    shipment.created_for = payload.created_for;

    await shipment.save();
    await ShipmentPackageInfo.query().where("hawb", shipment.hawb).delete();
    await ShipmentProductInfo.query().where("hawb", shipment.hawb).delete();
    await ShipmentHistory.query().where("hawb", shipment.hawb).delete();

    const dataArray = JSON.parse(request.input("product_data"));

    dataArray.forEach(async (item) => {
      const product = new ShipmentProductInfo();
      product.uuid = uuidv1();
      product.hawb = shipment.hawb;
      product.name = item.name;
      product.description = item.description;
      product.type = item.type;
      product.quantity = item.quantity;
      product.price = item.price;
      product.amount = item.amount;
      await product.save();
    });

    const packageArray = JSON.parse(request.input("package_data"));

    packageArray.forEach(async (item) => {
      const Package = new ShipmentPackageInfo();
      Package.uuid = uuidv1();
      Package.hawb = shipment.hawb;
      Package.quantity = item.quantity;
      Package.type = item.type;
      Package.length = item.length;
      Package.width = item.width;
      Package.height = item.height;
      Package.weight = item.weight;
      Package.subweight = item.subweight;
      Package.subvolume = item.subvolume;
      Package.subcharge = item.subcharge;
      await Package.save();
    });

    const shipment_historyArray = JSON.parse(request.input("shipment_history"));

    shipment_historyArray.forEach(async (item) => {
      const Shipment_History = new ShipmentHistory();
      Shipment_History.uuid = uuidv1();
      Shipment_History.hawb = shipment.hawb;

      // Convert the date to the correct format
      Shipment_History.date = DateTime.fromFormat(item.date, 'dd/MM/yyyy HH:mm').toFormat('yyyy-MM-dd HH:mm:ss');
      Shipment_History.status = item.status;
      Shipment_History.detail = item.detail;
      Shipment_History.location = item.location;
      await Shipment_History.save();
    });

    return response.ok({
      message: "shipment product successfully update",
      shipment,
    });
  }

public async destroy({ params, response }: HttpContextContract) {
  try {
    // Tìm kiếm shipment bằng hawb
    const shipment = await Shipment.findBy('hawb', params.id);

    // Nếu không tìm thấy shipment, trả về lỗi 404
    if (!shipment) {
      return response.notFound({ message: 'Shipment not found' });
    }

    // Xóa shipment
    await shipment.delete();

    // Trả về phản hồi thành công
    return response.ok({ message: 'Shipment deleted successfully.' });
  } catch (error) {
    console.error('Error deleting shipment: ', error);
    return response.status(500).send({ message: 'Failed to delete shipment' });
  }
}

  
  // Tracking Shipment - 16/5/2024
  public async tracking({ params, response }: HttpContextContract) {
    try {
      const { hawb } = params;

      // Fetch shipment details and related package and history information
      const shipment = await Shipment.query()
        .where('hawb', hawb)
        .preload('packageInfos')
        .preload('histories')
        .firstOrFail();
      

      // Calculate total weight from subcharges
      const totalWeight = shipment.packageInfos.reduce((acc, pkg) => acc + parseFloat(pkg.subcharge), 0);

      // Prepare shipment histories from shipment data
      const shipmentHistories = shipment.histories.map(history => ({
        date: history.date,
        status: history.status,
        detail: history.detail,
        location: history.location
      }));

      // Retrieve all related manifest IDs from ManifestShipment entries
      const manifestIDs = await ManifestShipment.query()
        .where('hawb', hawb)
        .select('manifest_id');
            
      // Fetch ManifestHistory based on manifest_ids
      const manifestHistories = [];
      if (manifestIDs.length > 0) {
        const histories = await ManifestHistory.query()
          .whereIn('manifest_id', manifestIDs.map(ms => ms.manifest_id))
          .select('date', 'manifest_status as status', 'detail', 'location');

        histories.forEach(history => {
          manifestHistories.push({
            date: history.date,
            status: history.status || 'in_transit', // Set default status if null
            detail: history.detail,
            location: history.location
          });
        });
      }

      // Combine all histories and sort by date in descending order
      const combinedHistories = [...shipmentHistories, ...manifestHistories]
        .sort((a, b) => b.date.getTime() - a.date.getTime()); // Ensure correct time comparison

      // Return the combined data as JSON
      return response.json({
        hwb: hawb,
        shipment_status: shipment.status,
        sender_country: shipment.sender_address.country,
        receiver_country: shipment.receiver_address.country,
        receiver_name: shipment.receiver_address.name,
        receiver_address: shipment.receiver_address.address_first,
        receiver_phone: shipment.receiver_address.phone,
        weight: totalWeight,
        tracking_history: combinedHistories.length > 0 ? combinedHistories : "No history available"
      });
    } catch (error) {
      // Handle errors such as not found or processing errors
      response.status(404).send({
        message: 'Shipment not found'
      });
    }
  }


  // Export Shipment
  public async exportToCSV({ response }: HttpContextContract) {
    try {
      const shipments = await Shipment.query().select(
        'hawb', 
        'local_code', 
        'local_tracking', 
        'status', 
        'created_at'
      );

      const csvStringifier = createCsvStringifier({
        header: [
          { id: 'hawb', title: 'HAWB' },
          { id: 'local_code', title: 'Local Code' },
          { id: 'local_tracking', title: 'Local Tracking' },
          { id: 'status', title: 'Status' },
          { id: 'created_at', title: 'Created At' }
        ]
      });

      const header = csvStringifier.getHeaderString();
      const records = csvStringifier.stringifyRecords(shipments);

      response.header('Content-Type', 'text/csv');
      response.header('Content-Disposition', 'attachment; filename="shipments.csv"');
      return response.send(header + records);
    } catch (error) {
      console.error('Failed to export shipments: ', error);
      return response.status(500).send({ message: "Failed to export shipments" });
    }
  }


}
