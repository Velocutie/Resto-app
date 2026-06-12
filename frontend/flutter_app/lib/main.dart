import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as io;

void main() {
  runApp(const RestoApp());
}

class RestoApp extends StatelessWidget {
  const RestoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Resto App',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.system,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xff0f9f7a),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: const Color(0xff0f9f7a),
      ),
      home: const RestoHome(),
    );
  }
}

class RestoHome extends StatefulWidget {
  const RestoHome({super.key});

  @override
  State<RestoHome> createState() => _RestoHomeState();
}

class _RestoHomeState extends State<RestoHome> {
  final api = RestoApi('http://localhost:3000');
  int tabIndex = 0;
  bool loading = true;
  Map<String, dynamic>? bootstrap;
  Map<String, dynamic>? tableContext;
  Map<String, dynamic>? menu;
  Map<String, dynamic>? currentOrder;
  final List<CartLine> cart = [];
  final Map<String, StaffSession> staff = {};
  io.Socket? socket;

  @override
  void initState() {
    super.initState();
    initialize();
  }

  Future<void> initialize() async {
    bootstrap = await api.get('/api/bootstrap');
    tableContext = await api.get('/api/qr/resolve?token=${bootstrap!['demoTableToken']}');
    menu = await api.get('/api/menu?restaurantId=${tableContext!['restaurant']['id']}&categoryId=all&diet=all');
    connectSocket();
    setState(() => loading = false);
  }

  void connectSocket() {
    socket = io.io(api.baseUrl, io.OptionBuilder().setTransports(['websocket']).build());
    socket?.emit('join:restaurant', {'restaurantId': tableContext!['restaurant']['id']});
    socket?.on('order:updated', (payload) {
      if (currentOrder != null && payload['id'] == currentOrder!['id']) {
        setState(() => currentOrder = Map<String, dynamic>.from(payload));
      }
    });
  }

  @override
  void dispose() {
    socket?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Resto App'),
            Text('Scan. Order. Enjoy.', style: TextStyle(fontSize: 12)),
          ],
        ),
      ),
      body: IndexedStack(
        index: tabIndex,
        children: [
          CustomerScreen(
            contextData: tableContext!,
            menu: menu!,
            cart: cart,
            order: currentOrder,
            onAdd: addToCart,
            onQuantity: updateQuantity,
            onPlaceOrder: placeOrder,
            onRequest: createRequest,
          ),
          StaffScreen(
            role: 'admin',
            session: staff['admin'],
            demo: bootstrap!['demoStaff']['admin'],
            api: api,
            onLogin: login,
          ),
          StaffScreen(
            role: 'kitchen',
            session: staff['kitchen'],
            demo: bootstrap!['demoStaff']['kitchen'],
            api: api,
            onLogin: login,
          ),
          StaffScreen(
            role: 'waiter',
            session: staff['waiter'],
            demo: bootstrap!['demoStaff']['waiter'],
            api: api,
            onLogin: login,
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tabIndex,
        onDestinationSelected: (value) => setState(() => tabIndex = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.qr_code_2), label: 'Customer'),
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Admin'),
          NavigationDestination(icon: Icon(Icons.soup_kitchen_outlined), label: 'Kitchen'),
          NavigationDestination(icon: Icon(Icons.room_service_outlined), label: 'Waiter'),
        ],
      ),
    );
  }

  void addToCart(Map<String, dynamic> item) {
    final index = cart.indexWhere((line) => line.id == item['id']);
    setState(() {
      if (index >= 0) {
        cart[index].quantity += 1;
      } else {
        cart.add(CartLine(item['id'], item['name'], (item['price'] as num).toDouble()));
      }
    });
  }

  void updateQuantity(int id, int delta) {
    setState(() {
      final line = cart.firstWhere((entry) => entry.id == id);
      line.quantity += delta;
      cart.removeWhere((entry) => entry.quantity <= 0);
    });
  }

  Future<void> placeOrder(String notes) async {
    final response = await api.post('/api/orders', {
      'tableToken': tableContext!['table']['qr_token'],
      'guestName': 'Guest',
      'notes': notes,
      'items': cart.map((line) => {
            'menuItemId': line.id,
            'quantity': line.quantity,
            'specialInstructions': '',
          }).toList(),
    });
    socket?.emit('join:order', {'orderId': response['id']});
    setState(() {
      currentOrder = response;
      cart.clear();
    });
  }

  Future<void> createRequest(String type) async {
    await api.post('/api/customer-requests', {
      'tableToken': tableContext!['table']['qr_token'],
      'orderId': currentOrder?['id'],
      'type': type,
    });
  }

  Future<void> login(String role, String phone, String password) async {
    final response = await api.post('/api/auth/login', {
      'phone': phone,
      'password': password,
    });
    setState(() => staff[role] = StaffSession(response['token'], response['user']));
  }
}

class CustomerScreen extends StatelessWidget {
  const CustomerScreen({
    required this.contextData,
    required this.menu,
    required this.cart,
    required this.order,
    required this.onAdd,
    required this.onQuantity,
    required this.onPlaceOrder,
    required this.onRequest,
    super.key,
  });

  final Map<String, dynamic> contextData;
  final Map<String, dynamic> menu;
  final List<CartLine> cart;
  final Map<String, dynamic>? order;
  final ValueChanged<Map<String, dynamic>> onAdd;
  final void Function(int id, int delta) onQuantity;
  final ValueChanged<String> onPlaceOrder;
  final ValueChanged<String> onRequest;

  @override
  Widget build(BuildContext context) {
    final restaurant = contextData['restaurant'];
    final table = contextData['table'];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(restaurant['name'], style: Theme.of(context).textTheme.headlineMedium),
        Text('Table ${table['label']}'),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          children: ['Need Water', 'Need Spoon', 'Need Bill', 'Call Waiter']
              .map((type) => ActionChip(label: Text(type), onPressed: () => onRequest(type)))
              .toList(),
        ),
        if (order != null) OrderTimeline(order: order!),
        const SizedBox(height: 16),
        ...menu['items'].map<Widget>((item) => MenuTile(item: item, onAdd: () => onAdd(item))),
        CartPanel(cart: cart, onQuantity: onQuantity, onPlaceOrder: onPlaceOrder),
      ],
    );
  }
}

class MenuTile extends StatelessWidget {
  const MenuTile({required this.item, required this.onAdd, super.key});

  final Map<String, dynamic> item;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(backgroundImage: NetworkImage(item['image_url'])),
        title: Text(item['name']),
        subtitle: Text('${item['description']}\n${item['diet_type']}'),
        isThreeLine: true,
        trailing: FilledButton(onPressed: onAdd, child: Text('Rs ${item['price']}')),
      ),
    );
  }
}

class CartPanel extends StatefulWidget {
  const CartPanel({
    required this.cart,
    required this.onQuantity,
    required this.onPlaceOrder,
    super.key,
  });

  final List<CartLine> cart;
  final void Function(int id, int delta) onQuantity;
  final ValueChanged<String> onPlaceOrder;

  @override
  State<CartPanel> createState() => _CartPanelState();
}

class _CartPanelState extends State<CartPanel> {
  final notes = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final subtotal = widget.cart.fold<double>(0, (sum, line) => sum + line.price * line.quantity);
    final gst = subtotal * 0.05;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Cart', style: Theme.of(context).textTheme.titleLarge),
            ...widget.cart.map((line) => ListTile(
                  title: Text(line.name),
                  subtitle: Text('Rs ${line.price} x ${line.quantity}'),
                  trailing: Wrap(
                    children: [
                      IconButton(onPressed: () => widget.onQuantity(line.id, -1), icon: const Icon(Icons.remove)),
                      IconButton(onPressed: () => widget.onQuantity(line.id, 1), icon: const Icon(Icons.add)),
                    ],
                  ),
                )),
            TextField(controller: notes, decoration: const InputDecoration(labelText: 'Order notes')),
            Text('GST: Rs ${gst.toStringAsFixed(2)}'),
            Text('Total: Rs ${(subtotal + gst).toStringAsFixed(2)}'),
            FilledButton(
              onPressed: widget.cart.isEmpty ? null : () => widget.onPlaceOrder(notes.text),
              child: const Text('Place order'),
            ),
          ],
        ),
      ),
    );
  }
}

class OrderTimeline extends StatelessWidget {
  const OrderTimeline({required this.order, super.key});

  final Map<String, dynamic> order;

  @override
  Widget build(BuildContext context) {
    const flow = ['received', 'accepted', 'preparing', 'ready', 'delivered'];
    final index = flow.indexOf(order['status']);
    return Card(
      child: Column(
        children: flow
            .map((status) => ListTile(
                  leading: Icon(flow.indexOf(status) <= index ? Icons.check_circle : Icons.radio_button_unchecked),
                  title: Text(status),
                ))
            .toList(),
      ),
    );
  }
}

class StaffScreen extends StatefulWidget {
  const StaffScreen({
    required this.role,
    required this.session,
    required this.demo,
    required this.api,
    required this.onLogin,
    super.key,
  });

  final String role;
  final StaffSession? session;
  final Map<String, dynamic> demo;
  final RestoApi api;
  final Future<void> Function(String role, String phone, String password) onLogin;

  @override
  State<StaffScreen> createState() => _StaffScreenState();
}

class _StaffScreenState extends State<StaffScreen> {
  List<dynamic> orders = [];
  List<dynamic> requests = [];

  @override
  Widget build(BuildContext context) {
    if (widget.session == null) {
      return LoginCard(role: widget.role, demo: widget.demo, onLogin: widget.onLogin);
    }
    return FutureBuilder(
      future: loadData(),
      builder: (context, snapshot) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${widget.role} panel', style: Theme.of(context).textTheme.headlineSmall),
          ...orders.map((order) => Card(
                child: ListTile(
                  title: Text('${order['order_number']} · Table ${order['table_label']}'),
                  subtitle: Text(order['status']),
                  trailing: FilledButton(
                    onPressed: () => nextStatus(order),
                    child: const Text('Update'),
                  ),
                ),
              )),
          if (widget.role == 'waiter')
            ...requests.map((request) => Card(
                  child: ListTile(
                    title: Text(request['type']),
                    subtitle: Text('Table ${request['table_label']}'),
                  ),
                )),
        ],
      ),
    );
  }

  Future<void> loadData() async {
    if (orders.isNotEmpty || requests.isNotEmpty) return;
    final status = widget.role == 'waiter' ? 'ready' : 'all';
    orders = await widget.api.get('/api/orders?status=$status', token: widget.session!.token) as List<dynamic>;
    if (widget.role == 'waiter') {
      requests = await widget.api.get('/api/waiter/requests', token: widget.session!.token) as List<dynamic>;
    }
  }

  Future<void> nextStatus(Map<String, dynamic> order) async {
    const transitions = {
      'received': 'accepted',
      'accepted': 'preparing',
      'preparing': 'ready',
      'ready': 'delivered',
    };
    final next = transitions[order['status']];
    if (next == null) return;
    await widget.api.patch('/api/orders/${order['id']}/status', {'status': next}, token: widget.session!.token);
    setState(() {
      orders.clear();
      requests.clear();
    });
  }
}

class LoginCard extends StatefulWidget {
  const LoginCard({required this.role, required this.demo, required this.onLogin, super.key});

  final String role;
  final Map<String, dynamic> demo;
  final Future<void> Function(String role, String phone, String password) onLogin;

  @override
  State<LoginCard> createState() => _LoginCardState();
}

class _LoginCardState extends State<LoginCard> {
  late final phone = TextEditingController(text: widget.demo['phone']);
  late final password = TextEditingController(text: widget.demo['password']);

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('${widget.role} login', style: Theme.of(context).textTheme.headlineSmall),
        TextField(controller: phone, decoration: const InputDecoration(labelText: 'Phone')),
        TextField(controller: password, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
        const SizedBox(height: 12),
        FilledButton(onPressed: () => widget.onLogin(widget.role, phone.text, password.text), child: const Text('Login')),
      ],
    );
  }
}

class RestoApi {
  RestoApi(this.baseUrl);

  final String baseUrl;

  Future<dynamic> get(String path, {String? token}) => request('GET', path, token: token);
  Future<dynamic> post(String path, Object body, {String? token}) => request('POST', path, body: body, token: token);
  Future<dynamic> patch(String path, Object body, {String? token}) => request('PATCH', path, body: body, token: token);

  Future<dynamic> request(String method, String path, {Object? body, String? token}) async {
    final request = http.Request(method, Uri.parse('$baseUrl$path'));
    request.headers['Content-Type'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) request.body = jsonEncode(body);
    final streamed = await request.send();
    final text = await streamed.stream.bytesToString();
    return jsonDecode(text);
  }
}

class StaffSession {
  StaffSession(this.token, this.user);

  final String token;
  final Map<String, dynamic> user;
}

class CartLine {
  CartLine(this.id, this.name, this.price, {this.quantity = 1});

  final int id;
  final String name;
  final double price;
  int quantity;
}
